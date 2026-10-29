//+------------------------------------------------------------------+
//| BinaryTradesBridge.mq5                                                |
//| Connects this MetaTrader 5 account to your binaryTrades dashboard.   |
//|                                                                  |
//| Setup:                                                           |
//|  1. Tools > Options > Expert Advisors: tick "Allow algorithmic    |
//|     trading" and "Allow WebRequest for listed URL", then add     |
//|     your binaryTrades server URL (e.g. https://your-app.vercel.app).  |
//|  2. Attach this EA to ONE chart (any symbol) and fill in the     |
//|     Server URL and Bridge key shown on the Brokers page.         |
//|  3. Keep the terminal running (a VPS keeps it online 24/7).      |
//|                                                                  |
//| Every few seconds the EA sends account info, open positions and |
//| recently closed deals, and executes the orders binaryTrades queued.   |
//| Lot size is calculated here from the risk amount and stop loss.  |
//+------------------------------------------------------------------+
#property copyright "binaryTrades"
#property version   "1.00"
#property strict

#include <Trade/Trade.mqh>

input string InpServerUrl       = "http://localhost:3000"; // binaryTrades server URL
input string InpBridgeKey       = "";                      // Bridge key (from the Brokers page)
input int    InpPollSeconds     = 3;                       // Sync interval (seconds)
input int    InpDefaultSlPoints = 300;                     // Stop (points) when a signal has none
input double InpMaxLots         = 5.0;                     // Hard cap on any single order
input int    InpSlippagePoints  = 30;                      // Max slippage (points)

CTrade   g_trade;
string   g_results[];
datetime g_lastOk = 0;
string   g_status = "starting";

//+------------------------------------------------------------------+
int OnInit()
{
   if(StringLen(InpBridgeKey) < 10)
   {
      Alert("BinaryTradesBridge: paste the Bridge key from the binaryTrades Brokers page into the EA inputs.");
      return INIT_PARAMETERS_INCORRECT;
   }
   g_trade.SetDeviationInPoints(InpSlippagePoints);
   EventSetTimer(MathMax(1, InpPollSeconds));
   Sync();
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   EventKillTimer();
   Comment("");
}

void OnTimer()
{
   Sync();
}

//+------------------------------------------------------------------+
//| JSON helpers                                                     |
//+------------------------------------------------------------------+
string Esc(string s)
{
   StringReplace(s, "\\", "\\\\");
   StringReplace(s, "\"", "\\\"");
   StringReplace(s, "\n", " ");
   StringReplace(s, "\r", " ");
   return s;
}

string Num(double v, int digits = 8)
{
   return DoubleToString(v, digits);
}

string BuildReport()
{
   string json = "{";
   json += "\"login\":\"" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + "\",";
   json += "\"server\":\"" + Esc(AccountInfoString(ACCOUNT_SERVER)) + "\",";
   json += "\"company\":\"" + Esc(AccountInfoString(ACCOUNT_COMPANY)) + "\",";
   json += "\"currency\":\"" + Esc(AccountInfoString(ACCOUNT_CURRENCY)) + "\",";
   json += "\"balance\":" + Num(AccountInfoDouble(ACCOUNT_BALANCE), 2) + ",";
   json += "\"equity\":" + Num(AccountInfoDouble(ACCOUNT_EQUITY), 2) + ",";
   json += "\"is_demo\":" + (AccountInfoInteger(ACCOUNT_TRADE_MODE) == ACCOUNT_TRADE_MODE_DEMO ? "true" : "false") + ",";

   // Open positions
   json += "\"positions\":[";
   int total = PositionsTotal();
   for(int i = 0; i < total; i++)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(i > 0) json += ",";
      long type = PositionGetInteger(POSITION_TYPE);
      double profit = PositionGetDouble(POSITION_PROFIT) + PositionGetDouble(POSITION_SWAP);
      json += "{";
      json += "\"ticket\":\"" + IntegerToString((long)ticket) + "\",";
      json += "\"symbol\":\"" + Esc(PositionGetString(POSITION_SYMBOL)) + "\",";
      json += "\"type\":\"" + (type == POSITION_TYPE_BUY ? "buy" : "sell") + "\",";
      json += "\"volume\":" + Num(PositionGetDouble(POSITION_VOLUME), 2) + ",";
      json += "\"price_open\":" + Num(PositionGetDouble(POSITION_PRICE_OPEN)) + ",";
      json += "\"price_current\":" + Num(PositionGetDouble(POSITION_PRICE_CURRENT)) + ",";
      json += "\"sl\":" + Num(PositionGetDouble(POSITION_SL)) + ",";
      json += "\"tp\":" + Num(PositionGetDouble(POSITION_TP)) + ",";
      json += "\"profit\":" + Num(profit, 2) + ",";
      json += "\"magic\":" + IntegerToString(PositionGetInteger(POSITION_MAGIC)) + ",";
      json += "\"comment\":\"" + Esc(PositionGetString(POSITION_COMMENT)) + "\"";
      json += "}";
   }
   json += "],";

   // Closing deals from the last 2 days (lets the server book final P&L)
   json += "\"deals\":[";
   bool first = true;
   if(HistorySelect(TimeCurrent() - 2 * 86400, TimeCurrent() + 3600))
   {
      int deals = HistoryDealsTotal();
      int start = MathMax(0, deals - 300);
      for(int i = start; i < deals; i++)
      {
         ulong deal = HistoryDealGetTicket(i);
         if(deal == 0) continue;
         long entry = HistoryDealGetInteger(deal, DEAL_ENTRY);
         if(entry != DEAL_ENTRY_OUT && entry != DEAL_ENTRY_OUT_BY && entry != DEAL_ENTRY_INOUT) continue;
         double profit = HistoryDealGetDouble(deal, DEAL_PROFIT) + HistoryDealGetDouble(deal, DEAL_SWAP) + HistoryDealGetDouble(deal, DEAL_COMMISSION);
         if(!first) json += ",";
         first = false;
         json += "{\"position_id\":\"" + IntegerToString(HistoryDealGetInteger(deal, DEAL_POSITION_ID)) + "\",";
         json += "\"profit\":" + Num(profit, 2) + ",";
         json += "\"price\":" + Num(HistoryDealGetDouble(deal, DEAL_PRICE)) + "}";
      }
   }
   json += "],";

   // Results of commands executed since the last successful sync
   json += "\"results\":[";
   for(int i = 0; i < ArraySize(g_results); i++)
   {
      if(i > 0) json += ",";
      json += g_results[i];
   }
   json += "]}";
   return json;
}

void AddResult(string commandId, bool ok, string ticket, double price, double volume, string error)
{
   string r = "{\"command_id\":\"" + Esc(commandId) + "\",\"ok\":" + (ok ? "true" : "false");
   if(ticket != "") r += ",\"ticket\":\"" + ticket + "\"";
   if(price > 0) r += ",\"price\":" + Num(price);
   if(volume > 0) r += ",\"volume\":" + Num(volume, 2);
   if(error != "") r += ",\"error\":\"" + Esc(error) + "\"";
   r += "}";
   int n = ArraySize(g_results);
   ArrayResize(g_results, n + 1);
   g_results[n] = r;
}

//+------------------------------------------------------------------+
//| Sync with the server                                             |
//+------------------------------------------------------------------+
void Sync()
{
   string url = InpServerUrl;
   while(StringLen(url) > 0 && StringSubstr(url, StringLen(url) - 1) == "/")
      url = StringSubstr(url, 0, StringLen(url) - 1);
   url += "/api/mt5/sync";

   string body = BuildReport();
   char data[];
   int n = StringToCharArray(body, data, 0, WHOLE_ARRAY, CP_UTF8);
   if(n > 0) ArrayResize(data, n - 1); // drop the NUL terminator

   char result[];
   string resultHeaders;
   string headers = "Content-Type: application/json\r\nX-Bridge-Key: " + InpBridgeKey + "\r\n";

   ResetLastError();
   int code = WebRequest("POST", url, headers, 10000, data, result, resultHeaders);
   if(code == -1)
   {
      int err = GetLastError();
      if(err == 4014)
         g_status = "BLOCKED: add " + InpServerUrl + " to Tools > Options > Expert Advisors > Allow WebRequest";
      else
         g_status = "Cannot reach server (error " + IntegerToString(err) + ")";
      ShowStatus();
      return;
   }

   string response = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);
   if(code != 200 || StringFind(response, "OK") != 0)
   {
      g_status = "Server said " + IntegerToString(code) + ": " + StringSubstr(response, 0, 120);
      ShowStatus();
      return;
   }

   // The server has the results now.
   ArrayResize(g_results, 0);
   g_lastOk = TimeCurrent();
   g_status = "Connected";

   string lines[];
   int count = StringSplit(response, '\n', lines);
   for(int i = 1; i < count; i++)
   {
      string line = lines[i];
      StringTrimRight(line);
      StringTrimLeft(line);
      if(StringLen(line) > 0) Execute(line);
   }
   ShowStatus();
}

void ShowStatus()
{
   Comment("binaryTrades Bridge: ", g_status,
           "\nLast sync: ", (g_lastOk > 0 ? TimeToString(g_lastOk, TIME_DATE | TIME_SECONDS) : "never"),
           "\nAlgo trading: ", (TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) ? "ON" : "OFF — press the Algo Trading button"));
}

//+------------------------------------------------------------------+
//| Command execution                                                |
//| Line format: id|type|symbol|side|risk_money|sl|tp|magic|ticket|comment
//+------------------------------------------------------------------+
void Execute(string line)
{
   string f[];
   if(StringSplit(line, '|', f) < 10)
   {
      Print("BinaryTradesBridge: malformed command: ", line);
      return;
   }
   string id = f[0], type = f[1];
   if(type == "open") OpenOrder(id, f[2], f[3], StringToDouble(f[4]), StringToDouble(f[5]), StringToDouble(f[6]), StringToInteger(f[7]), f[9]);
   else if(type == "close") ClosePosition(id, f[8], f[9]);
   else if(type == "close_all") CloseAll(id);
   else AddResult(id, false, "", 0, 0, "unknown command " + type);
}

double LotsForRisk(string symbol, double riskMoney, double stopDistance, string &error)
{
   double tickSize  = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_SIZE);
   double tickValue = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_VALUE_LOSS);
   if(tickValue <= 0) tickValue = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_VALUE);
   double minLot = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MIN);
   double maxLot = MathMin(SymbolInfoDouble(symbol, SYMBOL_VOLUME_MAX), InpMaxLots);
   double step   = SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP);
   if(tickSize <= 0 || tickValue <= 0 || step <= 0 || stopDistance <= 0)
   {
      error = "cannot size position (missing symbol data)";
      return 0;
   }
   double lossPerLot = stopDistance / tickSize * tickValue;
   double lots = MathFloor(riskMoney / lossPerLot / step) * step;
   if(lots < minLot)
   {
      // Allow the minimum lot only if it doesn't risk much more than asked.
      if(minLot * lossPerLot > riskMoney * 1.5)
      {
         error = "minimum lot would risk " + DoubleToString(minLot * lossPerLot, 2) + ", more than the allowed " + DoubleToString(riskMoney, 2);
         return 0;
      }
      lots = minLot;
   }
   return NormalizeDouble(MathMin(lots, maxLot), 2);
}

void OpenOrder(string id, string symbol, string side, double riskMoney, double sl, double tp, long magic, string comment)
{
   if(!SymbolSelect(symbol, true))
   {
      AddResult(id, false, "", 0, 0, "unknown symbol " + symbol + " (check Market Watch name, e.g. EURUSDm)");
      return;
   }
   bool buy = (side == "buy");
   double point = SymbolInfoDouble(symbol, SYMBOL_POINT);
   int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
   double price = buy ? SymbolInfoDouble(symbol, SYMBOL_ASK) : SymbolInfoDouble(symbol, SYMBOL_BID);
   if(price <= 0)
   {
      AddResult(id, false, "", 0, 0, "no price for " + symbol + " (market closed?)");
      return;
   }

   // Stop/target come from the data feed; make sure they are on the right side of this broker's price.
   if(sl <= 0 || (buy && sl >= price) || (!buy && sl <= price))
      sl = buy ? price - InpDefaultSlPoints * point : price + InpDefaultSlPoints * point;
   if(tp > 0 && ((buy && tp <= price) || (!buy && tp >= price)))
      tp = 0;
   double minStop = SymbolInfoInteger(symbol, SYMBOL_TRADE_STOPS_LEVEL) * point;
   if(MathAbs(price - sl) < minStop)
      sl = buy ? price - minStop * 1.5 : price + minStop * 1.5;
   sl = NormalizeDouble(sl, digits);
   tp = tp > 0 ? NormalizeDouble(tp, digits) : 0;

   string error = "";
   double lots = LotsForRisk(symbol, riskMoney, MathAbs(price - sl), error);
   if(lots <= 0)
   {
      AddResult(id, false, "", 0, 0, error);
      return;
   }

   g_trade.SetExpertMagicNumber((ulong)magic);
   g_trade.SetTypeFillingBySymbol(symbol);
   bool sent = buy ? g_trade.Buy(lots, symbol, 0, sl, tp, comment) : g_trade.Sell(lots, symbol, 0, sl, tp, comment);
   uint rc = g_trade.ResultRetcode();
   if(!sent || (rc != TRADE_RETCODE_DONE && rc != TRADE_RETCODE_PLACED && rc != TRADE_RETCODE_DONE_PARTIAL))
   {
      AddResult(id, false, "", 0, 0, "order rejected: " + g_trade.ResultRetcodeDescription());
      return;
   }

   string ticket = IntegerToString((long)g_trade.ResultOrder());
   ulong deal = g_trade.ResultDeal();
   if(deal > 0 && HistoryDealSelect(deal))
      ticket = IntegerToString(HistoryDealGetInteger(deal, DEAL_POSITION_ID));
   AddResult(id, true, ticket, g_trade.ResultPrice(), g_trade.ResultVolume(), "");
   Print("BinaryTradesBridge: ", side, " ", DoubleToString(lots, 2), " ", symbol, " sl=", sl, " tp=", tp, " ticket=", ticket);
}

void ClosePosition(string id, string ticketText, string comment)
{
   ulong ticket = (ulong)StringToInteger(ticketText);
   if(ticket == 0 && comment != "")
   {
      for(int i = PositionsTotal() - 1; i >= 0; i--)
      {
         ulong t = PositionGetTicket(i);
         if(t > 0 && PositionGetString(POSITION_COMMENT) == comment) { ticket = t; break; }
      }
   }
   if(ticket == 0 || !PositionSelectByTicket(ticket))
   {
      AddResult(id, false, "", 0, 0, "position not found (already closed?)");
      return;
   }
   if(g_trade.PositionClose(ticket))
      AddResult(id, true, IntegerToString((long)ticket), g_trade.ResultPrice(), 0, "");
   else
      AddResult(id, false, "", 0, 0, "close failed: " + g_trade.ResultRetcodeDescription());
}

void CloseAll(string id)
{
   int failed = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong t = PositionGetTicket(i);
      if(t > 0 && !g_trade.PositionClose(t)) failed++;
   }
   AddResult(id, failed == 0, "", 0, 0, failed == 0 ? "" : IntegerToString(failed) + " position(s) failed to close");
}
//+------------------------------------------------------------------+
