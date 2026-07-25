const fs = require('fs');
const path = require('path');

const file = 'C:/Users/hulbe/Downloads/torn-company-app-latest/public/gamble.html';
let html = fs.readFileSync(file, 'utf8');

// The panels to add
const newPanels = `
            <!-- Poker Pot Odds & Implied Prob -->
            <div class="panel">
                <div class="panel-header">♠️ Poker Pot Odds & Implied</div>
                <div class="panel-body">
                    <p style="color:var(--text-dim); font-size:0.9em; line-height:1.5; margin:0;">Input pot size, bet to call, and your number of outs (cards that give you a winning hand) to see if a call is mathematically profitable.</p>
                    
                    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:15px;">
                        <div class="input-group">
                            <label>Current Pot Size ($)</label>
                            <input type="number" id="poker-pot" value="1000">
                        </div>
                        <div class="input-group">
                            <label>Amount to Call ($)</label>
                            <input type="number" id="poker-call" value="200">
                        </div>
                        <div class="input-group">
                            <label>Your Outs (1-20)</label>
                            <input type="number" id="poker-outs" value="9">
                        </div>
                        <div class="input-group">
                            <label>Streets Remaining</label>
                            <select id="poker-streets">
                                <option value="1">1 (Turn or River)</option>
                                <option value="2">2 (Flop to River)</option>
                            </select>
                        </div>
                    </div>
                    
                    <button class="btn-action" style="background:var(--purple); color:white;" onclick="calcPoker()">Calculate Call Equity</button>
                    
                    <div class="result-box" id="poker-results" style="display:none; border-color:rgba(155,89,182,0.2); background:rgba(155,89,182,0.05);">
                        <div class="result-row">
                            <span class="res-label">Pot Odds (Required Equity)</span>
                            <span class="res-val" id="poker-pot-odds">0%</span>
                        </div>
                        <div class="result-row">
                            <span class="res-label">Card Odds (Actual Equity)</span>
                            <span class="res-val" id="poker-card-odds">0%</span>
                        </div>
                        <div class="result-row">
                            <span class="res-label">Decision</span>
                            <span class="res-val" id="poker-decision">FOLD</span>
                        </div>
                    </div>
                </div>
            </div>

            <!-- High-Low Probability Engine -->
            <div class="panel">
                <div class="panel-header">🃏 High-Low Probability</div>
                <div class="panel-body">
                    <p style="color:var(--text-dim); font-size:0.9em; line-height:1.5; margin:0;">Torn High-Low uses a standard 52-card deck. Select the current face-up card to find the mathematically optimal choice (High or Low).</p>
                    
                    <div class="input-group">
                        <label>Current Face-Up Card</label>
                        <select id="hl-card">
                            <option value="2">2</option>
                            <option value="3">3</option>
                            <option value="4">4</option>
                            <option value="5">5</option>
                            <option value="6">6</option>
                            <option value="7">7</option>
                            <option value="8">8</option>
                            <option value="9">9</option>
                            <option value="10">10</option>
                            <option value="11">Jack (J)</option>
                            <option value="12">Queen (Q)</option>
                            <option value="13">King (K)</option>
                            <option value="14">Ace (A)</option>
                        </select>
                    </div>
                    
                    <button class="btn-action" style="background:var(--teal); color:black;" onclick="calcHL()">Get Optimal Move</button>
                    
                    <div class="result-box" id="hl-results" style="display:none; border-color:rgba(0,206,201,0.2); background:rgba(0,206,201,0.05); text-align:center;">
                        <div style="display:flex; justify-content: space-around; margin-bottom: 10px;">
                            <div>
                                <div style="font-size:0.8em; color:var(--text-dim); text-transform:uppercase;">Odds Lower</div>
                                <div id="hl-low-odds" style="font-size:1.5em; font-weight:bold; color:var(--text-main);">0%</div>
                            </div>
                            <div>
                                <div style="font-size:0.8em; color:var(--text-dim); text-transform:uppercase;">Odds Higher</div>
                                <div id="hl-high-odds" style="font-size:1.5em; font-weight:bold; color:var(--text-main);">0%</div>
                            </div>
                        </div>
                        <div style="font-size: 0.9em; color: var(--text-dim); text-transform: uppercase; font-weight: bold; margin-bottom: 5px;">Mathematically Optimal Decision</div>
                        <div id="hl-decision" style="font-size: 3em; font-weight: 900; color: var(--teal); text-shadow: 0 0 10px rgba(0,206,201,0.3); text-transform: uppercase;">HIGH</div>
                    </div>
                </div>
            </div>

            <!-- Craps Odds Breakdown -->
            <div class="panel">
                <div class="panel-header">🎲 Craps Odds & House Edge</div>
                <div class="panel-body">
                    <p style="color:var(--text-dim); font-size:0.9em; line-height:1.5; margin:0;">Craps is one of the only games in the casino where you can get the house edge down to almost 0% with Odds bets.</p>
                    
                    <div class="result-box" style="margin-top:0;">
                        <div class="result-row"><span class="res-label">Pass Line / Come</span><span class="res-val" style="color:var(--teal); font-size:1em;">1.41% Edge</span></div>
                        <div class="result-row"><span class="res-label">Don't Pass / Don't Come</span><span class="res-val" style="color:var(--teal); font-size:1em;">1.36% Edge</span></div>
                        <div class="result-row"><span class="res-label">Pass Line + Max Odds</span><span class="res-val" style="color:var(--green); font-size:1em;">~0.00% Edge</span></div>
                        <div class="result-row"><span class="res-label">Place 6 or 8</span><span class="res-val" style="color:var(--gold); font-size:1em;">1.52% Edge</span></div>
                        <div class="result-row"><span class="res-label">Hardways / Prop Bets</span><span class="res-val" style="color:var(--red); font-size:1em;">9% - 16% Edge</span></div>
                    </div>
                </div>
            </div>

            <!-- Roulette Strategy Breakdown -->
            <div class="panel">
                <div class="panel-header">🔴 Roulette Odds Breakdown</div>
                <div class="panel-body">
                    <p style="color:var(--text-dim); font-size:0.9em; line-height:1.5; margin:0;">Torn uses European Roulette (Single Zero). The house edge on almost every bet is exactly 2.70%.</p>
                    
                    <div class="result-box" style="margin-top:0;">
                        <div class="result-row"><span class="res-label">Red/Black, Odd/Even</span><span class="res-val" style="color:var(--teal); font-size:1em;">48.65% Win</span></div>
                        <div class="result-row"><span class="res-label">Dozens / Columns</span><span class="res-val" style="color:var(--teal); font-size:1em;">32.43% Win</span></div>
                        <div class="result-row"><span class="res-label">Single Number</span><span class="res-val" style="color:var(--teal); font-size:1em;">2.70% Win</span></div>
                        <div class="result-row"><span class="res-label">House Edge (Constant)</span><span class="res-val" style="color:var(--red); font-size:1em;">2.70% Edge</span></div>
                    </div>
                </div>
            </div>

            <!-- Slots ROI Breakdown -->
            <div class="panel">
                <div class="panel-header">🎰 Slots ROI Estimation</div>
                <div class="panel-body">
                    <p style="color:var(--text-dim); font-size:0.9em; line-height:1.5; margin:0;">Slot machines are purely RNG with no player edge. While Torn's exact Return to Player (RTP) is hidden, most casino slots operate at a 90-95% RTP.</p>
                    
                    <div class="result-box" style="margin-top:0;">
                        <div class="result-row"><span class="res-label">Estimated RTP</span><span class="res-val" style="color:var(--gold); font-size:1em;">~90% - 95%</span></div>
                        <div class="result-row"><span class="res-label">House Edge</span><span class="res-val" style="color:var(--red); font-size:1em;">5% - 10%</span></div>
                        <div class="result-row" style="border:none; padding-bottom:0;"><span class="res-label" style="font-size:0.8em; text-transform:none;">Mathematically, slots are a net loss over infinite spins. Play for merits or fun only.</span></div>
                    </div>
                </div>
            </div>

            <!-- Keno Odds Breakdown -->
            <div class="panel">
                <div class="panel-header">🔢 Keno Mathematical Odds</div>
                <div class="panel-body">
                    <p style="color:var(--text-dim); font-size:0.9em; line-height:1.5; margin:0;">Keno has historically the worst odds of any casino game. The house edge can exceed 25% depending on how many numbers you pick.</p>
                    
                    <div class="result-box" style="margin-top:0;">
                        <div class="result-row"><span class="res-label">Pick 10, Catch 10 Odds</span><span class="res-val" style="color:var(--red); font-size:1em;">1 in 8,911,711</span></div>
                        <div class="result-row"><span class="res-label">Optimal Strategy</span><span class="res-val" style="color:var(--gold); font-size:1em;">Don't Play</span></div>
                    </div>
                </div>
            </div>
`;

// Insert the new HTML panels before the closing container div
html = html.replace(/(<\/div>\s*<\/div>\s*<script>)/, newPanels + '\n$1');

// Now inject the new JavaScript functions for Poker and High-Low
const newJs = `
    function calcPoker() {
        let pot = parseFloat(document.getElementById('poker-pot').value);
        let call = parseFloat(document.getElementById('poker-call').value);
        let outs = parseInt(document.getElementById('poker-outs').value);
        let streets = parseInt(document.getElementById('poker-streets').value);
        
        if (isNaN(pot) || isNaN(call) || isNaN(outs)) return;
        
        // Required Equity (Pot Odds)
        // If pot is 1000, call is 200, total pot after call is 1200. You are risking 200 to win 1200.
        let requiredEquity = (call / (pot + call)) * 100;
        
        // Rule of 2 and 4 for Hold'em
        // 1 street = outs * 2. 2 streets = outs * 4.
        let actualEquity = (streets === 2) ? (outs * 4) : (outs * 2);
        // Better approximation for 2 streets if outs > 8: (outs * 4) - (outs - 8)
        if (streets === 2 && outs > 8) {
            actualEquity = (outs * 4) - (outs - 8);
        }
        
        document.getElementById('poker-pot-odds').textContent = requiredEquity.toFixed(1) + "%";
        document.getElementById('poker-card-odds').textContent = actualEquity.toFixed(1) + "%";
        
        let decEl = document.getElementById('poker-decision');
        if (actualEquity >= requiredEquity) {
            decEl.textContent = "CALL";
            decEl.style.color = "var(--green)";
            decEl.style.textShadow = "0 0 10px rgba(46, 204, 113, 0.3)";
        } else {
            decEl.textContent = "FOLD";
            decEl.style.color = "var(--red)";
            decEl.style.textShadow = "0 0 10px rgba(255, 71, 87, 0.3)";
        }
        
        document.getElementById('poker-results').style.display = "block";
    }

    function calcHL() {
        let card = parseInt(document.getElementById('hl-card').value);
        if (isNaN(card)) return;
        
        // Standard deck is 52 cards (2 through Ace). 4 of each rank.
        // Number of ranks below = card - 2. (e.g. if card is 8, ranks below are 2,3,4,5,6,7 = 6 ranks)
        // Number of cards below = ranks below * 4
        // Total cards left in deck = 51 (1 drawn)
        
        let ranksBelow = card - 2;
        let ranksAbove = 14 - card;
        
        // Assuming single deck, no card counting history.
        let cardsBelow = ranksBelow * 4;
        let cardsAbove = ranksAbove * 4;
        // Remaining 3 cards of the SAME rank result in a push/loss depending on game rules.
        // We will just calculate probability of strictly lower or strictly higher.
        
        let probLow = (cardsBelow / 51) * 100;
        let probHigh = (cardsAbove / 51) * 100;
        
        document.getElementById('hl-low-odds').textContent = probLow.toFixed(1) + "%";
        document.getElementById('hl-high-odds').textContent = probHigh.toFixed(1) + "%";
        
        let decEl = document.getElementById('hl-decision');
        if (probLow > probHigh) {
            decEl.textContent = "LOWER";
            decEl.style.color = "var(--blue)";
            decEl.style.textShadow = "0 0 10px rgba(88, 166, 255, 0.3)";
        } else if (probHigh > probLow) {
            decEl.textContent = "HIGHER";
            decEl.style.color = "var(--teal)";
            decEl.style.textShadow = "0 0 10px rgba(0, 206, 201, 0.3)";
        } else {
            decEl.textContent = "EVEN ODDS";
            decEl.style.color = "var(--gold)";
            decEl.style.textShadow = "0 0 10px rgba(255, 165, 2, 0.3)";
        }
        
        document.getElementById('hl-results').style.display = "block";
    }
`;

html = html.replace(/(<\/script>\s*<\/body>)/, newJs + '\n$1');

fs.writeFileSync(file, html);
console.log('gamble.html fully expanded');
