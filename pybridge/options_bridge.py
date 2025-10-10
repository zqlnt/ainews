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
        num_expiries = int(sys.argv[3]) if len(sys.argv) > 3 else 2
        num_expiries = min(num_expiries, 3)  # Cap at 3
        
        import yfinance as yf
        import pandas as pd
        
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
                # Get nearest N expiries
                expiries_to_fetch = list(expiries)[:num_expiries]
                
                for expiry_str in expiries_to_fetch:
                    # Parse expiry date
                    expiry_date = pd.to_datetime(expiry_str)
                    expiry_utc = expiry_date.tz_localize('UTC').replace(hour=0, minute=0, second=0)
                    
                    # Calculate days to expiry
                    now = datetime.now(timezone.utc)
                    ttm_days = (expiry_utc - now).total_seconds() / 86400
                    
                    # Skip if beyond max_days
                    if ttm_days > max_days:
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
                            
                            # Filter: iv > 0, oi >= 0, ttmDays <= max_days
                            if iv > 0 and oi >= 0 and ttm_days <= max_days and strike > 0:
                                rows.append({
                                    "expiryUTC": expiry_utc.isoformat(),
                                    "ttmDays": round(ttm_days, 2),
                                    "strike": round(strike, 2),
                                    "type": "call",
                                    "iv": round(iv, 4),
                                    "oi": oi,
                                    "volume": volume
                                })
                    
                    # Process puts
                    if hasattr(opt_chain, 'puts') and not opt_chain.puts.empty:
                        for _, row in opt_chain.puts.iterrows():
                            iv = float(row.get('impliedVolatility', 0))
                            oi = int(row.get('openInterest', 0))
                            strike = float(row.get('strike', 0))
                            volume = int(row.get('volume', 0)) if pd.notna(row.get('volume')) else 0
                            
                            if iv > 0 and oi >= 0 and ttm_days <= max_days and strike > 0:
                                rows.append({
                                    "expiryUTC": expiry_utc.isoformat(),
                                    "ttmDays": round(ttm_days, 2),
                                    "strike": round(strike, 2),
                                    "type": "put",
                                    "iv": round(iv, 4),
                                    "oi": oi,
                                    "volume": volume
                                })
        except:
            pass
        
        # Output result
        result = {
            "spot": round(spot, 2) if spot else None,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "rows": rows
        }
        
        print(json.dumps(result))
        sys.exit(0)
        
    except Exception as e:
        # Always return valid JSON, even on error
        print(json.dumps({
            "spot": None,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "rows": []
        }))
        sys.exit(0)

if __name__ == "__main__":
    main()

