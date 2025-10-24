#!/usr/bin/env python3
"""
YFinance Options Bridge
Usage: python3 options_bridge.py <SYMBOL> [max_days=30] [expiries=2]
Returns JSON with spot price and options data for Node.js consumption
"""

import sys
import json
from datetime import datetime, timezone
import warnings
warnings.filterwarnings('ignore')

def main():
    try:
        # Parse arguments
        if len(sys.argv) < 2:
            print(json.dumps({"spot": None, "fetched_at": datetime.now(timezone.utc).isoformat(), "rows": []}))
            sys.exit(0)
        
        symbol = sys.argv[1].upper()
        max_days = int(sys.argv[2]) if len(sys.argv) > 2 else 30
        num_expiries = int(sys.argv[3]) if len(sys.argv) > 3 else 5  # Fetch 5 by default
        num_expiries = min(max(num_expiries, 3), 8)  # Min 3, max 8 expiries
        
        import yfinance as yf
        import pandas as pd
        
        # Set browser-like headers to avoid bot detection
        yf.utils.USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        
        ticker = yf.Ticker(symbol)
        
        # Get spot price
        spot = None
        try:
            info = ticker.info
            spot = info.get('regularMarketPrice') or info.get('currentPrice')
            if not spot:
                # Fallback to last close
                hist = ticker.history(period="1d")
                if not hist.empty:
                    spot = float(hist['Close'].iloc[-1])
        except:
            pass
        
        # Get options expiries
        rows = []
        try:
            expiries = ticker.options
            if expiries:
                # Filter out expired expiries BEFORE fetching chains
                now = datetime.now(timezone.utc)
                valid_expiries = []
                
                for expiry_str in expiries[:num_expiries * 2]:  # Check 2x to find enough valid ones
                    expiry_date = pd.to_datetime(expiry_str)
                    expiry_utc = expiry_date.tz_localize('UTC').replace(hour=0, minute=0, second=0)
                    ttm_days = (expiry_utc - now).total_seconds() / 86400
                    
                    # Only include non-expired expiries within max_days
                    if ttm_days > 0 and ttm_days <= max_days:
                        valid_expiries.append(expiry_str)
                        if len(valid_expiries) >= num_expiries:
                            break
                
                # Fetch option chains for valid expiries only
                for expiry_str in valid_expiries:
                    # Parse expiry date
                    expiry_date = pd.to_datetime(expiry_str)
                    expiry_utc = expiry_date.tz_localize('UTC').replace(hour=0, minute=0, second=0)
                    
                    # Calculate days to expiry
                    ttm_days = (expiry_utc - now).total_seconds() / 86400
                    
                    # Skip if expired or beyond max_days (safety check)
                    if ttm_days <= 0 or ttm_days > max_days:
                        continue
                    
                    # Get options chain
                    opt_chain = ticker.option_chain(expiry_str)
                    
                    # Process calls
                    if hasattr(opt_chain, 'calls') and not opt_chain.calls.empty:
                        for _, row in opt_chain.calls.iterrows():
                            iv = float(row.get('impliedVolatility', 0))
                            oi = int(row.get('openInterest', 0))
                            strike = float(row.get('strike', 0))
                            volume = int(row.get('volume', 0)) if pd.notna(row.get('volume')) else 0
                            bid = float(row.get('bid', 0)) if pd.notna(row.get('bid')) else 0
                            ask = float(row.get('ask', 0)) if pd.notna(row.get('ask')) else 0
                            last_price = float(row.get('lastPrice', 0)) if pd.notna(row.get('lastPrice')) else 0
                            
                            # Filter: iv > 0, oi >= 0, not expired, ttmDays <= max_days
                            if iv > 0 and oi >= 0 and ttm_days > 0 and ttm_days <= max_days and strike > 0:
                                rows.append({
                                    "expiryUTC": expiry_utc.isoformat(),
                                    "ttmDays": round(ttm_days, 2),
                                    "strike": round(strike, 2),
                                    "type": "call",
                                    "iv": round(iv, 4),
                                    "oi": oi,
                                    "volume": volume,
                                    "bid": round(bid, 2) if bid > 0 else 0,
                                    "ask": round(ask, 2) if ask > 0 else 0,
                                    "lastPrice": round(last_price, 2) if last_price > 0 else 0
                                })
                    
                    # Process puts
                    if hasattr(opt_chain, 'puts') and not opt_chain.puts.empty:
                        for _, row in opt_chain.puts.iterrows():
                            iv = float(row.get('impliedVolatility', 0))
                            oi = int(row.get('openInterest', 0))
                            strike = float(row.get('strike', 0))
                            volume = int(row.get('volume', 0)) if pd.notna(row.get('volume')) else 0
                            bid = float(row.get('bid', 0)) if pd.notna(row.get('bid')) else 0
                            ask = float(row.get('ask', 0)) if pd.notna(row.get('ask')) else 0
                            last_price = float(row.get('lastPrice', 0)) if pd.notna(row.get('lastPrice')) else 0
                            
                            if iv > 0 and oi >= 0 and ttm_days > 0 and ttm_days <= max_days and strike > 0:
                                rows.append({
                                    "expiryUTC": expiry_utc.isoformat(),
                                    "ttmDays": round(ttm_days, 2),
                                    "strike": round(strike, 2),
                                    "type": "put",
                                    "iv": round(iv, 4),
                                    "oi": oi,
                                    "volume": volume,
                                    "bid": round(bid, 2) if bid > 0 else 0,
                                    "ask": round(ask, 2) if ask > 0 else 0,
                                    "lastPrice": round(last_price, 2) if last_price > 0 else 0
                                })
        except:
            pass
        
        # Calculate additional metrics if we have spot and rows
        atm_iv = None
        put_call_volume_ratio = None
        implied_move = None
        
        if spot and rows:
            # Find nearest expiry for metrics (use first expiry ≤ 30d)
            expiries_in_data = sorted(set(r['expiryUTC'] for r in rows))
            if expiries_in_data:
                nearest_expiry = expiries_in_data[0]
                expiry_rows = [r for r in rows if r['expiryUTC'] == nearest_expiry]
                
                # 1. ATM IV: Find strike nearest to spot
                if expiry_rows:
                    strikes = sorted(set(r['strike'] for r in expiry_rows))
                    atm_strike = min(strikes, key=lambda s: abs(s - spot))
                    
                    atm_call = next((r for r in expiry_rows if r['strike'] == atm_strike and r['type'] == 'call'), None)
                    atm_put = next((r for r in expiry_rows if r['strike'] == atm_strike and r['type'] == 'put'), None)
                    
                    if atm_call and atm_put:
                        avg_iv = (atm_call['iv'] + atm_put['iv']) / 2
                        atm_iv = {
                            "percent": round(avg_iv * 100, 1),
                            "decimal": round(avg_iv, 4),
                            "strike": atm_strike
                        }
                    elif atm_call:
                        atm_iv = {
                            "percent": round(atm_call['iv'] * 100, 1),
                            "decimal": round(atm_call['iv'], 4),
                            "strike": atm_strike
                        }
                    elif atm_put:
                        atm_iv = {
                            "percent": round(atm_put['iv'] * 100, 1),
                            "decimal": round(atm_put['iv'], 4),
                            "strike": atm_strike
                        }
                
                # 2. Put/Call Volume Ratio (for nearest expiry)
                total_call_vol = sum(r['volume'] for r in expiry_rows if r['type'] == 'call')
                total_put_vol = sum(r['volume'] for r in expiry_rows if r['type'] == 'put')
                
                if total_call_vol > 0:
                    pcr = total_put_vol / total_call_vol
                    put_call_volume_ratio = {
                        "ratio": round(pcr, 2),
                        "window": "expiry"
                    }
                
                # 3. Implied Move (ATM straddle)
                if atm_call and atm_put:
                    # Calculate mid price for call
                    call_mid = None
                    if atm_call['bid'] > 0 and atm_call['ask'] > 0:
                        call_mid = (atm_call['bid'] + atm_call['ask']) / 2
                    elif atm_call['lastPrice'] > 0:
                        call_mid = atm_call['lastPrice']
                    
                    # Calculate mid price for put
                    put_mid = None
                    if atm_put['bid'] > 0 and atm_put['ask'] > 0:
                        put_mid = (atm_put['bid'] + atm_put['ask']) / 2
                    elif atm_put['lastPrice'] > 0:
                        put_mid = atm_put['lastPrice']
                    
                    if call_mid and put_mid:
                        straddle = call_mid + put_mid
                        implied_move = {
                            "abs": round(straddle, 2),
                            "pct": round((straddle / spot) * 100, 1),
                            "expiry": nearest_expiry
                        }
        
        # Output result
        result = {
            "spot": round(spot, 2) if spot else None,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "rows": rows,
            "atm_iv": atm_iv,
            "put_call_volume_ratio": put_call_volume_ratio,
            "implied_move": implied_move
        }
        
        print(json.dumps(result))
        sys.exit(0)
        
    except Exception as e:
        # Log error to stderr for debugging, then return valid JSON
        import traceback
        sys.stderr.write(f"ERROR: {type(e).__name__}: {str(e)}\n")
        traceback.print_exc(file=sys.stderr)
        
        print(json.dumps({
            "spot": None,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "rows": []
        }))
        sys.exit(0)

if __name__ == "__main__":
    main()

