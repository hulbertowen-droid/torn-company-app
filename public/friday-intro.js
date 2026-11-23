/**
 * FactionOS — F.R.I.D.A.Y. Mark-85 Hyper-Realistic Holographic Visor Boot Engine (~6.2s)
 *
 * Features:
 * - Phase 1 (0.0-1.15s): Nanotech faceplate seal, camera impact shake, ocular filaments & lens flare
 * - Phase 2 (1.15-2.85s): 3D tilted orbital rings, rotating geodesic sphere, hex armor shimmer & pitch/roll verniers
 * - Phase 3 (2.85-4.70s): Left/Right optical telemetry wings (Arc Output graph + Warboard Threat Radar) & F.R.I.D.A.Y. voice
 * - Phase 4 (4.70-5.55s): Full operative biometric lock-on, golden/cyan shockwave & diagnostics confirmation
 * - Phase 5 (5.55-6.20s): Nanotech aperture iris dissolve revealing live Warboard underneath
 */
(function () {
    'use strict';

    if (window.__fridayIntroEngineLoaded) return;
    window.__fridayIntroEngineLoaded = true;

    const PREF_ENABLED_KEY = 'sv_intro_enabled';
    const PREF_SOUND_KEY = 'sv_intro_sound';
    const DURATION_MS = 6200;
    const DISSOLVE_MS = 480;

    let activeSession = null;

    function isWarboardPage() {
        const p = (window.location.pathname || '/').toLowerCase();
        return p === '/' || p === '/index.html' || p === '';
    }

    function isAutoIntroEnabled() {
        try {
            return localStorage.getItem(PREF_ENABLED_KEY) !== '0';
        } catch (_) {
            return true;
        }
    }

    function isSoundEnabled() {
        try {
            return localStorage.getItem(PREF_SOUND_KEY) !== '0';
        } catch (_) {
            return true;
        }
    }

    function hasNoIntroBypass() {
        try {
            const params = new URLSearchParams(window.location.search || '');
            if (params.get('no_intro') === '1' || params.get('skip_intro') === '1') return true;
        } catch (_) {}
        try {
            if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
                return true;
            }
        } catch (_) {}
        return false;
    }

    function clearBootGuard() {
        const guard = document.getElementById('friday-intro-boot-guard');
        if (guard) guard.remove();
        try { document.documentElement.classList.remove('friday-intro-pending'); } catch (_) {}
    }

    function getOperativeInfo() {
        let user = null;
        try {
            if (window.svAuth && typeof window.svAuth.getUser === 'function') user = window.svAuth.getUser();
            else if (typeof window.getUserProfile === 'function') user = window.getUserProfile();
            if (!user) {
                const raw = sessionStorage.getItem('sv_user') || localStorage.getItem('sv_user');
                if (raw) user = JSON.parse(raw);
            }
        } catch (_) {}

        const name = (user && user.playerName) || localStorage.getItem('warboard_myname') || '';
        const pid = (user && user.playerId) || localStorage.getItem('warboard_myPlayerId') || '';
        const fname = (user && user.factionName) || localStorage.getItem('warboard_myFactionName') || '';
        const fid = (user && user.factionId) || localStorage.getItem('warboard_myFactionId') || '';

        return {
            authenticated: Boolean(name),
            playerName: name ? String(name) : 'GUEST',
            playerId: pid ? String(pid) : '',
            factionLabel: fname ? String(fname) : (fid && fid !== '0' ? `Faction #${fid}` : 'SPIDER-VERSE NET')
        };
    }

    function createAudioEngine() {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        let ctx = null;
        let analyser = null;
        let master = null;
        let freqData = null;
        let blockedByAutoplay = false;
        let closed = false;
        let spokeGreeting = false;
        let voiceSpeakingUntil = 0;
        const playedStage = {};

        function ensureContext() {
            if (closed || !AudioCtx) return null;
            if (!ctx) {
                ctx = new AudioCtx();
                analyser = ctx.createAnalyser();
                analyser.fftSize = 128;
                freqData = new Uint8Array(analyser.frequencyBinCount);
                master = ctx.createGain();
                master.gain.value = 0.36;
                master.connect(analyser);
                analyser.connect(ctx.destination);
            }
            return ctx;
        }

        async function unlock() {
            if (!isSoundEnabled() || closed) return false;
            const c = ensureContext();
            if (!c) return false;
            if (c.state === 'suspended') {
                try { await c.resume(); } catch (_) {}
            }
            blockedByAutoplay = c.state !== 'running';
            return !blockedByAutoplay;
        }

        function playTone(freqStart, freqEnd, duration, type, gainPeak, delay = 0, filterType = null, cutoffStart = null, cutoffEnd = null) {
            if (!ctx || ctx.state !== 'running' || !master || closed) return;
            const now = ctx.currentTime + delay;
            const osc = ctx.createOscillator();
            const g = ctx.createGain();
            const filter = ctx.createBiquadFilter();

            osc.type = type || 'sine';
            osc.frequency.setValueAtTime(freqStart, now);
            if (freqEnd && freqEnd !== freqStart) {
                osc.frequency.exponentialRampToValueAtTime(Math.max(18, freqEnd), now + duration);
            }

            filter.type = filterType || (type === 'sawtooth' ? 'lowpass' : 'bandpass');
            const f0 = cutoffStart || (type === 'sawtooth' ? 320 : Math.max(freqStart, freqEnd || freqStart) * 1.4);
            filter.frequency.setValueAtTime(f0, now);
            if (cutoffEnd) {
                filter.frequency.exponentialRampToValueAtTime(Math.max(40, cutoffEnd), now + duration * 0.85);
            }

            g.gain.setValueAtTime(0.0001, now);
            g.gain.exponentialRampToValueAtTime(gainPeak, now + Math.min(0.06, duration * 0.25));
            g.gain.exponentialRampToValueAtTime(0.0001, now + duration);

            osc.connect(filter);
            filter.connect(g);
            g.connect(master);

            osc.start(now);
            osc.stop(now + duration + 0.05);
        }

        function playServoNoise(duration, centerFreq, gainPeak, delay = 0) {
            if (!ctx || ctx.state !== 'running' || !master || closed) return;
            const bufferSize = Math.max(1, Math.floor(ctx.sampleRate * duration));
            const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
            const data = buffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) {
                data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.35));
            }
            const src = ctx.createBufferSource();
            src.buffer = buffer;
            const filter = ctx.createBiquadFilter();
            filter.type = 'bandpass';
            filter.frequency.value = centerFreq;
            filter.Q.value = 2.4;
            const g = ctx.createGain();
            const now = ctx.currentTime + delay;
            g.gain.setValueAtTime(gainPeak, now);
            g.gain.exponentialRampToValueAtTime(0.0001, now + duration);
            src.connect(filter);
            filter.connect(g);
            g.connect(master);
            src.start(now);
        }

        function triggerStage(stageNum, operative) {
            if (!isSoundEnabled() || closed || playedStage[stageNum]) return;
            const c = ensureContext();
            if (!c || c.state !== 'running') {
                blockedByAutoplay = true;
                return;
            }
            playedStage[stageNum] = true;

            if (stageNum === 1) {
                // Titanium faceplate mechanical clamp + deep arc reactor ignition swell
                playServoNoise(0.24, 950, 0.28, 0.08);
                playTone(105, 34, 0.28, 'sine', 0.34, 0.1, 'lowpass', 300, 60);
                playTone(42, 140, 2.2, 'sawtooth', 0.16, 0.25, 'lowpass', 180, 1750);
                playTone(84, 210, 1.9, 'triangle', 0.12, 0.3, 'lowpass', 350, 1400);
            } else if (stageNum === 2) {
                // Precision optical vernier clicks & holographic array boot
                playTone(1760, 2093, 0.07, 'sine', 0.075, 0);
                playTone(2349, 2637, 0.07, 'sine', 0.065, 0.11);
                playTone(1318, 1760, 0.14, 'triangle', 0.07, 0.24);
                playServoNoise(0.14, 2400, 0.09, 0.18);
            } else if (stageNum === 3) {
                // Telemetry acquisition triple chime + F.R.I.D.A.Y. voice
                playTone(784, 1174, 0.12, 'sine', 0.08, 0);
                playTone(1046.5, 1568, 0.16, 'sine', 0.085, 0.14);
                speakGreeting(operative);
            } else if (stageNum === 4) {
                // Full Suit Lock harmonic shimmer triad
                [220, 277.18, 329.63, 440, 554.37].forEach((f, idx) => {
                    playTone(f, f * 1.004, 1.25, 'triangle', 0.055, idx * 0.035, 'lowpass', 2200, 750);
                });
                playTone(1480, 740, 0.38, 'sine', 0.07, 0.06);
            }
        }

        function speakGreeting(operative) {
            if (spokeGreeting || !isSoundEnabled() || closed) return;
            if (!ctx || ctx.state !== 'running') return;
            if (typeof window.speechSynthesis === 'undefined' || typeof SpeechSynthesisUtterance === 'undefined') return;

            spokeGreeting = true;
            try {
                window.speechSynthesis.cancel();
                const phrase = operative && operative.authenticated && operative.playerName !== 'GUEST'
                    ? `Friday online. Welcome back, ${operative.playerName}. All Warboard systems armed.`
                    : `Friday Mark eighty-five interface online. Systems armed.`;
                const utter = new SpeechSynthesisUtterance(phrase);
                utter.rate = 1.04;
                utter.pitch = 1.05;
                utter.volume = 0.82;

                const voices = window.speechSynthesis.getVoices ? window.speechSynthesis.getVoices() : [];
                if (voices && voices.length) {
                    const preferred = voices.find(v => /en-IE/i.test(v.lang) && /moira|emily|neural/i.test(v.name))
                        || voices.find(v => /en-(GB|IE|AU|US)/i.test(v.lang) && /libby|sonia|samantha|serena|kate|moira|zira|aria|jenny|natural|google uk english female/i.test(v.name))
                        || voices.find(v => /^en[-_]/i.test(v.lang));
                    if (preferred) utter.voice = preferred;
                }
                voiceSpeakingUntil = performance.now() + 2600;
                utter.onend = () => { voiceSpeakingUntil = 0; };
                window.speechSynthesis.speak(utter);
            } catch (_) {}
        }

        function sampleSpectrum(barsCount, timeSec) {
            const out = new Array(barsCount);
            const speechBoost = performance.now() < voiceSpeakingUntil
                ? 0.25 * (0.5 + 0.5 * Math.sin(timeSec * 19.0) * Math.cos(timeSec * 7.3))
                : 0;
            if (analyser && freqData && ctx && ctx.state === 'running' && isSoundEnabled()) {
                analyser.getByteFrequencyData(freqData);
                for (let i = 0; i < barsCount; i++) {
                    const idx = Math.min(freqData.length - 1, Math.floor((i / barsCount) * (freqData.length * 0.72)));
                    const v = freqData[idx] / 255;
                    const wave = 0.14 + 0.16 * Math.abs(Math.sin(timeSec * 6.2 + i * 0.42)) + speechBoost * Math.abs(Math.sin(i * 0.55 + timeSec * 13));
                    out[i] = Math.min(1, Math.max(v, wave));
                }
                return out;
            }
            for (let i = 0; i < barsCount; i++) {
                out[i] = 0.16 + 0.26 * Math.abs(Math.sin(timeSec * 4.8 + i * 0.36)) * (0.62 + 0.38 * Math.cos(timeSec * 2.4 - i * 0.19));
            }
            return out;
        }

        function stop() {
            closed = true;
            voiceSpeakingUntil = 0;
            try {
                if (window.speechSynthesis) window.speechSynthesis.cancel();
            } catch (_) {}
            if (master && ctx) {
                try {
                    const t = ctx.currentTime;
                    master.gain.setValueAtTime(master.gain.value, t);
                    master.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
                } catch (_) {}
            }
            setTimeout(() => {
                if (ctx && ctx.state !== 'closed') {
                    try { ctx.close(); } catch (_) {}
                }
                ctx = null;
            }, 240);
        }

        return {
            unlock,
            triggerStage,
            sampleSpectrum,
            isBlocked: () => blockedByAutoplay && isSoundEnabled(),
            isSpeaking: () => performance.now() < voiceSpeakingUntil,
            stop
        };
    }

    function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
    function easeOutCubic(t) { const x = clamp01(t); return 1 - Math.pow(1 - x, 3); }
    function easeInOutCubic(t) { const x = clamp01(t); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }
    function easeOutBack(t) {
        const x = clamp01(t);
        const c1 = 1.70158;
        const c3 = c1 + 1;
        return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
    }

    // 3D Rotation helper (yaw, pitch)
    function project3D(x, y, z, yaw, pitch, dist, cx, cy, scale) {
        const cyaw = Math.cos(yaw), syaw = Math.sin(yaw);
        const x1 = x * cyaw - z * syaw;
        const z1 = x * syaw + z * cyaw;
        const cpitch = Math.cos(pitch), spitch = Math.sin(pitch);
        const y2 = y * cpitch - z1 * spitch;
        const z2 = y * spitch + z1 * cpitch;
        const persp = dist / Math.max(0.4, dist + z2);
        return {
            x: cx + x1 * scale * persp,
            y: cy + y2 * scale * persp,
            z: z2,
            scale: persp
        };
    }

    function playFridayIntro(options = {}) {
        const force = Boolean(options.force);
        if (!force) {
            if (!isWarboardPage() || !isAutoIntroEnabled() || hasNoIntroBypass()) {
                clearBootGuard();
                return;
            }
        }

        if (activeSession) {
            if (!force) return;
            dismissFridayIntro(true);
        }

        const operative = getOperativeInfo();
        const audio = createAudioEngine();

        const overlay = document.createElement('div');
        overlay.id = 'friday-intro-overlay';
        overlay.className = 'friday-intro-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-label', 'F.R.I.D.A.Y. Mark-85 Tactical Boot Sequence');

        overlay.innerHTML = `
            <canvas id="friday-intro-canvas" class="friday-intro-canvas"></canvas>
            <div class="friday-intro-visor-vignette"></div>
            <div class="friday-intro-hud-chrome">
                <div class="friday-intro-topline">
                    <span class="friday-intro-tag"><span class="fi-dot"></span> MARK-85 ARMOR HUD // F.R.I.D.A.Y. AI</span>
                    <span class="friday-intro-clock" id="friday-intro-subclock">SUIT SEAL 000%</span>
                </div>
                <div class="friday-intro-bottom">
                    <div class="friday-intro-console" id="friday-intro-console" aria-hidden="true"></div>
                    <div class="friday-intro-controls">
                        <button type="button" class="friday-intro-pill" id="friday-intro-audio-btn" aria-label="Toggle Stark Audio"></button>
                        <button type="button" class="friday-intro-pill" id="friday-intro-autohide-btn" aria-label="Toggle Auto-Play on Entry"></button>
                        <button type="button" class="friday-intro-skip" id="friday-intro-skip-btn">Skip Intro →</button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);
        clearBootGuard();

        const canvas = overlay.querySelector('#friday-intro-canvas');
        const ctx2d = canvas.getContext('2d');
        const subClockEl = overlay.querySelector('#friday-intro-subclock');
        const consoleEl = overlay.querySelector('#friday-intro-console');
        const audioBtn = overlay.querySelector('#friday-intro-audio-btn');
        const autoBtn = overlay.querySelector('#friday-intro-autohide-btn');
        const skipBtn = overlay.querySelector('#friday-intro-skip-btn');

        let vw = window.innerWidth;
        let vh = window.innerHeight;
        let dpr = Math.min(window.devicePixelRatio || 1, 2);

        function resizeCanvas() {
            vw = window.innerWidth;
            vh = window.innerHeight;
            dpr = Math.min(window.devicePixelRatio || 1, 2);
            canvas.width = Math.max(1, Math.floor(vw * dpr));
            canvas.height = Math.max(1, Math.floor(vh * dpr));
            canvas.style.width = vw + 'px';
            canvas.style.height = vh + 'px';
        }
        resizeCanvas();

        // Volumetric depth motes & dust sparks
        const particles = Array.from({ length: 115 }, () => ({
            x: (Math.random() - 0.5) * 2.2,
            y: (Math.random() - 0.5) * 2.2,
            z: Math.random() * 1.5 + 0.12,
            amber: Math.random() > 0.58,
            size: Math.random() * 2.0 + 0.65,
            speed: 0.008 + Math.random() * 0.014
        }));

        // Radar threat blips inside right telemetry wing
        const radarBlips = [
            { r: 0.34, ang: 0.9, label: 'TGT-01' },
            { r: 0.62, ang: 2.7, label: 'HOSTILE' },
            { r: 0.48, ang: 4.4, label: 'CHAIN' }
        ];

        // Precompute hex mesh vertices for subtle armored helmet shimmer
        const hexCenters = [];
        const hexR = 34;
        const hexDx = hexR * 1.55;
        const hexDy = hexR * Math.sqrt(3) * 0.92;
        for (let row = -1; row < Math.ceil(vh / hexDy) + 2; row++) {
            for (let col = -1; col < Math.ceil(vw / hexDx) + 2; col++) {
                const hx = col * hexDx;
                const hy = row * hexDy + (col % 2 === 0 ? 0 : hexDy * 0.5);
                hexCenters.push([hx, hy]);
            }
        }

        let pointerX = 0;
        let pointerY = 0;
        let smoothX = 0;
        let smoothY = 0;

        function onPointerMove(e) {
            if (!e) return;
            pointerX = ((e.clientX || vw / 2) / vw - 0.5) * 2;
            pointerY = ((e.clientY || vh / 2) / vh - 0.5) * 2;
        }
        window.addEventListener('pointermove', onPointerMove, { passive: true });
        window.addEventListener('resize', resizeCanvas);

        function syncControlLabels() {
            const soundOn = isSoundEnabled();
            if (audioBtn) {
                if (!soundOn) {
                    audioBtn.innerHTML = '🔇 Audio: OFF';
                    audioBtn.classList.remove('pulse');
                } else if (audio.isBlocked()) {
                    audioBtn.innerHTML = '🔊 Tap for Sound';
                    audioBtn.classList.add('pulse');
                } else {
                    audioBtn.innerHTML = '🔊 Stark Audio: ON';
                    audioBtn.classList.remove('pulse');
                }
            }
            if (autoBtn) {
                const autoOn = isAutoIntroEnabled();
                autoBtn.textContent = autoOn ? '⚡ Auto-Intro: ON' : '⏸️ Auto-Intro: OFF';
                autoBtn.classList.toggle('muted-pref', !autoOn);
            }
        }

        audio.unlock().then(() => { syncControlLabels(); });
        syncControlLabels();

        async function tryUnlockFromGesture(e) {
            if (e && e.target && (e.target.closest('#friday-intro-skip-btn') || e.target.closest('#friday-intro-autohide-btn') || e.target.closest('#friday-intro-audio-btn'))) {
                return;
            }
            if (isSoundEnabled() && audio.isBlocked()) {
                const ok = await audio.unlock();
                if (ok) {
                    const elapsed = performance.now() - startMs;
                    if (elapsed < 1150) audio.triggerStage(1, operative);
                    else if (elapsed < 2850) audio.triggerStage(2, operative);
                    else if (elapsed < 4600) audio.triggerStage(3, operative);
                    else audio.triggerStage(4, operative);
                    syncControlLabels();
                }
            }
        }
        overlay.addEventListener('pointerdown', tryUnlockFromGesture, { passive: true });

        let touchStartY = 0;
        overlay.addEventListener('touchstart', (e) => {
            touchStartY = e.touches && e.touches[0] ? e.touches[0].clientY : 0;
        }, { passive: true });
        overlay.addEventListener('touchend', (e) => {
            const endY = e.changedTouches && e.changedTouches[0] ? e.changedTouches[0].clientY : touchStartY;
            if (touchStartY - endY > 68) dismissFridayIntro(false);
        }, { passive: true });

        if (audioBtn) {
            audioBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (audio.isBlocked() && isSoundEnabled()) {
                    await audio.unlock();
                    audio.triggerStage(3, operative);
                } else {
                    const next = !isSoundEnabled();
                    try { localStorage.setItem(PREF_SOUND_KEY, next ? '1' : '0'); } catch (_) {}
                    if (next) {
                        await audio.unlock();
                        audio.triggerStage(3, operative);
                    } else {
                        try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (_) {}
                    }
                }
                syncControlLabels();
            });
        }

        if (autoBtn) {
            autoBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const next = !isAutoIntroEnabled();
                try { localStorage.setItem(PREF_ENABLED_KEY, next ? '1' : '0'); } catch (_) {}
                syncControlLabels();
            });
        }

        if (skipBtn) {
            skipBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                dismissFridayIntro(false);
            });
        }

        function onKeyDown(e) {
            if (e.key === 'Escape' || e.key === ' ' || e.key === 'Enter') {
                e.preventDefault();
                dismissFridayIntro(false);
            }
        }
        document.addEventListener('keydown', onKeyDown);

        const consoleLines = [
            { at: 0.16, tag: 'SUIT', color: '#ff8a1f', text: 'MARK-85 OPTIC SEAL & ARC TURBINE', status: 'LOCKED' },
            { at: 0.34, tag: 'CORE', color: '#38bdf8', text: 'F.R.I.D.A.Y. NEURAL CORTEX', status: 'ONLINE' },
            { at: 0.52, tag: 'AUTH', color: '#38bdf8', text: `OPERATIVE: ${operative.playerName}${operative.playerId ? ` [${operative.playerId}]` : ''}`, status: operative.authenticated ? 'VERIFIED' : 'STANDBY' },
            { at: 0.68, tag: 'LINK', color: '#10b981', text: `${operative.factionLabel.toUpperCase()} TACTICAL NET`, status: 'SYNCED' },
            { at: 0.80, tag: 'HUD ', color: '#fbbf24', text: 'WARBOARD // SENTINEL // ARMORY', status: 'ARMED' }
        ];
        const renderedLines = new Set();

        let rafId = 0;
        let finished = false;
        const startMs = performance.now();

        function drawTilted3DRing(cx, cy, radius, tiltX, tiltY, spinAngle, color, lineWidth, arcs = 3, dashArc = false) {
            const steps = 64;
            ctx2d.save();
            ctx2d.strokeStyle = color;
            ctx2d.lineWidth = lineWidth;
            for (let a = 0; a < arcs; a++) {
                const startA = spinAngle + (a * Math.PI * 2) / arcs + 0.16;
                const endA = spinAngle + ((a + 1) * Math.PI * 2) / arcs - 0.24;
                const segSteps = Math.max(8, Math.floor((steps * (endA - startA)) / (Math.PI * 2)));
                ctx2d.beginPath();
                for (let s = 0; s <= segSteps; s++) {
                    const ang = startA + ((endA - startA) * s) / segSteps;
                    if (dashArc && s % 3 === 2) continue;
                    const px = Math.cos(ang);
                    const py = Math.sin(ang);
                    const pt = project3D(px, py, 0, tiltY, tiltX, 3.2, cx, cy, radius);
                    if (s === 0 || (dashArc && s % 3 === 0)) ctx2d.moveTo(pt.x, pt.y);
                    else ctx2d.lineTo(pt.x, pt.y);
                }
                ctx2d.stroke();
            }
            ctx2d.restore();
        }

        function drawFrame(now) {
            if (finished) return;
            const elapsed = now - startMs;
            const p = Math.min(1, elapsed / DURATION_MS);
            const t = elapsed / 1000;

            smoothX += (pointerX - smoothX) * 0.08;
            smoothY += (pointerY - smoothY) * 0.08;

            // Camera impact shake impulses (at helmet seal ~0.22s & lock-on ~4.65s)
            let shakeX = 0, shakeY = 0;
            if (elapsed > 140 && elapsed < 440) {
                const mag = (1 - (elapsed - 140) / 300) * 7.5;
                shakeX = (Math.random() - 0.5) * mag;
                shakeY = (Math.random() - 0.5) * mag;
            } else if (elapsed > 4600 && elapsed < 4950) {
                const mag = (1 - (elapsed - 4600) / 350) * 5.0;
                shakeX = (Math.random() - 0.5) * mag;
                shakeY = (Math.random() - 0.5) * mag;
            }

            // Stage audio cues
            if (p >= 0.01) audio.triggerStage(1, operative);
            if (p >= 0.22) audio.triggerStage(2, operative);
            if (p >= 0.48) audio.triggerStage(3, operative);
            if (p >= 0.74) audio.triggerStage(4, operative);

            // Console telemetry lines
            if (consoleEl) {
                for (let i = 0; i < consoleLines.length; i++) {
                    const line = consoleLines[i];
                    if (p >= line.at && !renderedLines.has(i)) {
                        renderedLines.add(i);
                        const row = document.createElement('div');
                        row.className = 'fi-log-line';
                        const tagEl = document.createElement('span');
                        tagEl.className = 'fi-log-tag';
                        tagEl.style.color = line.color;
                        tagEl.textContent = `[${line.tag}]`;
                        const bodyEl = document.createElement('span');
                        bodyEl.className = 'fi-log-body';
                        bodyEl.textContent = line.text;
                        const statEl = document.createElement('span');
                        statEl.className = 'fi-log-stat';
                        statEl.textContent = line.status;
                        row.append(tagEl, ' ', bodyEl, ' ', statEl);
                        consoleEl.appendChild(row);
                    }
                }
            }
            if (subClockEl) {
                if (p < 0.18) subClockEl.textContent = 'VISOR SEALING...';
                else if (p < 0.74) subClockEl.textContent = `BOOT ${String(Math.min(99, Math.round((p / 0.76) * 100))).padStart(3, '0')}%`;
                else if (p < 0.89) subClockEl.textContent = 'MARK-85 ARMED';
                else subClockEl.textContent = 'HUD ENGAGED';
            }

            // ── Render Canvas ───────────────────────────────────────────────────
            ctx2d.save();
            ctx2d.scale(dpr, dpr);
            ctx2d.translate(shakeX, shakeY);
            ctx2d.clearRect(-20, -20, vw + 40, vh + 40);

            const cx = vw * 0.5 + smoothX * 10;
            const cy = (vw < 640 ? vh * 0.36 : vh * 0.43) + smoothY * 10;
            const minDim = Math.min(vw, vh);
            const coreR = Math.max(76, Math.min(176, minDim * (vw < 640 ? 0.255 : 0.215)));

            // 1. Deep Visor Gradient Backdrop (warms subtly as core ignites)
            const igniteGlow = easeOutCubic(p / 0.25);
            const bgGrad = ctx2d.createRadialGradient(cx, cy, 8, cx, cy, Math.max(vw, vh) * 0.82);
            bgGrad.addColorStop(0, `rgba(12, 34, 68, ${0.42 * igniteGlow + 0.15})`);
            bgGrad.addColorStop(0.42, `rgba(6, 16, 36, 0.94)`);
            bgGrad.addColorStop(1, '#010308');
            ctx2d.fillStyle = '#010308';
            ctx2d.fillRect(-20, -20, vw + 40, vh + 40);
            ctx2d.fillStyle = bgGrad;
            ctx2d.fillRect(-20, -20, vw + 40, vh + 40);

            // 2. Hexagonal Nanotech Helmet Mesh illuminated by vertical laser sweep
            const scanNorm = (p > 0.12 && p < 0.82) ? ((p - 0.12) / 0.70) : -1;
            const scanY = scanNorm >= 0 ? vh * (0.06 + scanNorm * 0.88) : -999;
            if (p > 0.1) {
                ctx2d.save();
                ctx2d.lineWidth = 0.8;
                const meshAlpha = easeOutCubic((p - 0.1) / 0.25) * 0.12;
                for (let h = 0; h < hexCenters.length; h++) {
                    const [hx, hy] = hexCenters[h];
                    const dScan = Math.abs(hy - scanY);
                    const boost = dScan < 85 ? (1 - dScan / 85) * 0.28 : 0;
                    const distCenter = Math.hypot(hx - cx, hy - cy);
                    if (distCenter < coreR * 0.9) continue; // keep center clear for hologram
                    const a = meshAlpha + boost;
                    if (a < 0.03) continue;
                    ctx2d.strokeStyle = boost > 0.08 ? `rgba(56, 189, 248, ${a})` : `rgba(56, 189, 248, ${a * 0.45})`;
                    ctx2d.beginPath();
                    for (let k = 0; k < 6; k++) {
                        const ka = (Math.PI / 3) * k;
                        const px = hx + Math.cos(ka) * (hexR * 0.82);
                        const py = hy + Math.sin(ka) * (hexR * 0.82);
                        if (k === 0) ctx2d.moveTo(px, py);
                        else ctx2d.lineTo(px, py);
                    }
                    ctx2d.closePath();
                    ctx2d.stroke();
                }
                ctx2d.restore();
            }

            // 3. 3D Holographic Depth Starfield / Optical Dust
            ctx2d.save();
            ctx2d.globalCompositeOperation = 'lighter';
            for (let i = 0; i < particles.length; i++) {
                const pt = particles[i];
                pt.z -= pt.speed;
                if (pt.z <= 0.06) {
                    pt.z = 1.5;
                    pt.x = (Math.random() - 0.5) * 2.2;
                    pt.y = (Math.random() - 0.5) * 2.2;
                }
                const sx = vw * 0.5 + (pt.x / pt.z) * vw * 0.44 + smoothX * 20 * (1.6 - pt.z);
                const sy = vh * 0.43 + (pt.y / pt.z) * vh * 0.44 + smoothY * 20 * (1.6 - pt.z);
                if (sx < -20 || sx > vw + 20 || sy < -20 || sy > vh + 20) continue;
                const alpha = Math.min(0.85, (1.5 - pt.z) * 0.68) * easeOutCubic(p * 3.5);
                ctx2d.fillStyle = pt.amber ? `rgba(255, 132, 31, ${alpha})` : `rgba(56, 189, 248, ${alpha})`;
                ctx2d.beginPath();
                ctx2d.arc(sx, sy, (pt.size / pt.z) * 0.75, 0, Math.PI * 2);
                ctx2d.fill();
            }
            ctx2d.restore();

            // 4. Phase 1: Helmet Faceplate Eye-Slit Initialization & Optical Bloom
            if (p < 0.28) {
                const sealT = easeInOutCubic(p / 0.14);
                const openIris = easeOutCubic(Math.max(0, (p - 0.08) / 0.2));
                const maskGap = (vh * 0.55) * openIris;
                // Closing / opening dark titanium visor plates with bright cyan/gold seam
                if (maskGap < vh * 0.52) {
                    ctx2d.save();
                    ctx2d.fillStyle = '#02040a';
                    ctx2d.fillRect(-20, -20, vw + 40, Math.max(0, cy - maskGap));
                    ctx2d.fillRect(-20, cy + maskGap, vw + 40, vh);
                    // Glowing visor seam edge
                    const seamG = ctx2d.createLinearGradient(0, cy - maskGap, vw, cy - maskGap);
                    seamG.addColorStop(0, 'rgba(56, 189, 248, 0)');
                    seamG.addColorStop(0.5, `rgba(56, 189, 248, ${(1 - openIris) * 0.9 * sealT})`);
                    seamG.addColorStop(1, 'rgba(56, 189, 248, 0)');
                    ctx2d.strokeStyle = seamG;
                    ctx2d.lineWidth = 2.5;
                    ctx2d.beginPath();
                    ctx2d.moveTo(0, cy - maskGap);
                    ctx2d.lineTo(vw, cy - maskGap);
                    ctx2d.moveTo(0, cy + maskGap);
                    ctx2d.lineTo(vw, cy + maskGap);
                    ctx2d.stroke();
                    ctx2d.restore();
                }
            }

            // 5. Core 3D Geodesic Wireframe + Tilted Gyroscopic Orbital Rings
            const ringScale = easeOutBack(clamp01((p - 0.08) / 0.28));
            const pulseBreath = 1 + Math.sin(t * 4.0) * 0.018;
            const R = coreR * ringScale * pulseBreath;

            if (R > 6) {
                ctx2d.save();
                ctx2d.globalCompositeOperation = 'lighter';

                // Volumetric Plasma Aura
                const aura = ctx2d.createRadialGradient(cx, cy, R * 0.04, cx, cy, R * 1.55);
                aura.addColorStop(0, 'rgba(56, 189, 248, 0.26)');
                aura.addColorStop(0.35, 'rgba(255, 115, 0, 0.16)');
                aura.addColorStop(0.7, 'rgba(56, 189, 248, 0.05)');
                aura.addColorStop(1, 'rgba(0, 0, 0, 0)');
                ctx2d.fillStyle = aura;
                ctx2d.beginPath();
                ctx2d.arc(cx, cy, R * 1.55, 0, Math.PI * 2);
                ctx2d.fill();

                // True 3D Projected Rotating Geodesic Sphere inside core
                const yaw = t * 0.65 + smoothX * 0.5;
                const pitch = 0.35 + Math.sin(t * 0.45) * 0.18 + smoothY * 0.35;
                const sphereR = R * 0.58;
                ctx2d.strokeStyle = 'rgba(56, 189, 248, 0.22)';
                ctx2d.lineWidth = 0.9;
                for (let lat = -2; lat <= 2; lat++) {
                    const phi = (lat / 3) * (Math.PI * 0.5);
                    const ringR = Math.cos(phi);
                    const yOff = Math.sin(phi);
                    ctx2d.beginPath();
                    for (let i = 0; i <= 36; i++) {
                        const th = (i / 36) * Math.PI * 2;
                        const pr = project3D(Math.cos(th) * ringR, yOff, Math.sin(th) * ringR, yaw, pitch, 3.0, cx, cy, sphereR);
                        if (i === 0) ctx2d.moveTo(pr.x, pr.y);
                        else ctx2d.lineTo(pr.x, pr.y);
                    }
                    ctx2d.stroke();
                }
                for (let lon = 0; lon < 6; lon++) {
                    const th = (lon / 6) * Math.PI;
                    ctx2d.beginPath();
                    for (let j = 0; j <= 32; j++) {
                        const phi = (j / 32) * Math.PI * 2;
                        const pr = project3D(Math.cos(th) * Math.sin(phi), Math.cos(phi), Math.sin(th) * Math.sin(phi), yaw, pitch, 3.0, cx, cy, sphereR);
                        if (j === 0) ctx2d.moveTo(pr.x, pr.y);
                        else ctx2d.lineTo(pr.x, pr.y);
                    }
                    ctx2d.stroke();
                }

                // Dual 3D Tilted Gyroscopic Rings (Stark Hologram Perspective)
                const gyroAlpha = easeOutCubic(clamp01((p - 0.16) / 0.25));
                drawTilted3DRing(cx, cy, R * 1.18, 0.42 + smoothY * 0.25, 0.25 + smoothX * 0.25, t * 0.95, `rgba(56, 189, 248, ${0.42 * gyroAlpha})`, 1.4, 4, false);
                drawTilted3DRing(cx, cy, R * 1.08, -0.38 - smoothY * 0.2, 0.48 + smoothX * 0.2, -t * 1.25, `rgba(255, 132, 31, ${0.46 * gyroAlpha})`, 1.6, 3, true);

                // Precision 2D Cyan Degree Tick Compass Ring
                ctx2d.save();
                ctx2d.translate(cx, cy);
                ctx2d.rotate(t * 0.22);
                ctx2d.strokeStyle = 'rgba(56, 189, 248, 0.78)';
                ctx2d.lineWidth = 1.4;
                for (let d = 0; d < 96; d++) {
                    const ang = (d / 96) * Math.PI * 2;
                    const major = d % 8 === 0;
                    const r1 = R * (major ? 1.16 : 1.21);
                    const r2 = R * 1.26;
                    ctx2d.globalAlpha = major ? 0.9 : 0.35;
                    ctx2d.beginPath();
                    ctx2d.moveTo(Math.cos(ang) * r1, Math.sin(ang) * r1);
                    ctx2d.lineTo(Math.cos(ang) * r2, Math.sin(ang) * r2);
                    ctx2d.stroke();
                }
                ctx2d.restore();

                // Signature F.R.I.D.A.Y. Burnt-Orange Thick Orbital Segments
                ctx2d.save();
                ctx2d.translate(cx, cy);
                ctx2d.rotate(t * 0.84);
                ctx2d.strokeStyle = '#ff7b00';
                ctx2d.shadowColor = '#ff6a00';
                ctx2d.shadowBlur = 22;
                ctx2d.lineWidth = 5.8;
                ctx2d.beginPath();
                ctx2d.arc(0, 0, R * 0.88, 0.22, Math.PI * 1.08);
                ctx2d.stroke();
                ctx2d.beginPath();
                ctx2d.arc(0, 0, R * 0.88, Math.PI * 1.26, Math.PI * 1.92);
                ctx2d.stroke();

                ctx2d.lineWidth = 2.2;
                ctx2d.strokeStyle = '#fbbf24';
                ctx2d.beginPath();
                ctx2d.arc(0, 0, R * 0.77, -0.35, Math.PI * 0.62);
                ctx2d.stroke();
                ctx2d.restore();

                // Counter-rotating Outer Arc-Cyan Ring
                ctx2d.save();
                ctx2d.translate(cx, cy);
                ctx2d.rotate(-t * 0.52);
                ctx2d.strokeStyle = '#38bdf8';
                ctx2d.shadowColor = '#00e5ff';
                ctx2d.shadowBlur = 16;
                ctx2d.lineWidth = 2.8;
                for (let s = 0; s < 3; s++) {
                    const base = s * ((Math.PI * 2) / 3);
                    ctx2d.beginPath();
                    ctx2d.arc(0, 0, R * 1.04, base + 0.14, base + 1.48);
                    ctx2d.stroke();
                }
                ctx2d.restore();

                // 64 Audio-Reactive Volumetric Spectrum Needles
                const bars = 64;
                const spec = audio.sampleSpectrum(bars, t);
                ctx2d.save();
                ctx2d.translate(cx, cy);
                const specAlpha = easeOutCubic(clamp01((p - 0.18) / 0.22));
                ctx2d.globalAlpha = specAlpha * 0.9;
                for (let b = 0; b < bars; b++) {
                    const ang = (b / bars) * Math.PI * 2 - Math.PI / 2;
                    const mag = spec[b];
                    const len = 3 + mag * (R * 0.2);
                    const br0 = R * 1.31;
                    const br1 = br0 + len;
                    ctx2d.strokeStyle = b % 4 === 0 ? '#ff8811' : (audio.isSpeaking() ? '#7dd3fc' : '#38bdf8');
                    ctx2d.lineWidth = 2;
                    ctx2d.beginPath();
                    ctx2d.moveTo(Math.cos(ang) * br0, Math.sin(ang) * br0);
                    ctx2d.lineTo(Math.cos(ang) * br1, Math.sin(ang) * br1);
                    ctx2d.stroke();
                }
                ctx2d.restore();

                // Anamorphic Lens Flare Streak at Core Ignition & Final Lock-On
                const flareStrength = (p < 0.3 ? Math.sin((p / 0.3) * Math.PI) * 0.65 : 0) + (p > 0.72 && p < 0.92 ? Math.sin(((p - 0.72) / 0.2) * Math.PI) * 0.85 : 0);
                if (flareStrength > 0.02) {
                    const fl = ctx2d.createLinearGradient(cx - vw * 0.45, cy, cx + vw * 0.45, cy);
                    fl.addColorStop(0, 'rgba(56, 189, 248, 0)');
                    fl.addColorStop(0.35, `rgba(56, 189, 248, ${flareStrength * 0.35})`);
                    fl.addColorStop(0.5, `rgba(255, 225, 180, ${flareStrength * 0.8})`);
                    fl.addColorStop(0.65, `rgba(255, 123, 0, ${flareStrength * 0.35})`);
                    fl.addColorStop(1, 'rgba(255, 123, 0, 0)');
                    ctx2d.fillStyle = fl;
                    ctx2d.fillRect(cx - vw * 0.45, cy - 2.2, vw * 0.9, 4.4);
                }

                ctx2d.restore(); // end 'lighter' composite

                // Crisp F.R.I.D.A.Y. Center Wordmark & Lock Sublabel
                const textAlpha = easeOutCubic(clamp01((p - 0.14) / 0.2));
                const locked = p > 0.56;
                ctx2d.save();
                ctx2d.globalAlpha = textAlpha;
                ctx2d.textAlign = 'center';
                ctx2d.textBaseline = 'middle';
                ctx2d.shadowColor = locked ? '#ff8a1f' : '#38bdf8';
                ctx2d.shadowBlur = locked ? 24 : 14;
                ctx2d.fillStyle = '#ffffff';
                const fSize = Math.round(R * 0.255);
                ctx2d.font = `900 ${fSize}px "JetBrains Mono", ui-monospace, SFMono-Regular, monospace`;
                ctx2d.fillText('F.R.I.D.A.Y.', cx, cy - fSize * 0.15);

                ctx2d.shadowBlur = 0;
                ctx2d.fillStyle = locked ? '#fbbf24' : '#7dd3fc';
                ctx2d.font = `700 ${Math.max(8, Math.round(R * 0.075))}px "Inter", system-ui, sans-serif`;
                const subTxt = p > 0.74
                    ? (operative.authenticated ? `OPERATIVE LOCK: ${operative.playerName.toUpperCase()}` : 'SYSTEMS ARMED')
                    : (p > 0.42 ? 'ESTABLISHING TACTICAL UPLINK' : 'CALIBRATING VISOR OPTICS');
                ctx2d.fillText(subTxt, cx, cy + fSize * 0.65);
                ctx2d.restore();
            }

            // 6. Sliding Compass Azimuth Ribbon (Top Center) & Left/Right Vernier Pitch Ladders
            const hudAlpha = easeOutCubic(clamp01((p - 0.18) / 0.2));
            if (hudAlpha > 0.02) {
                ctx2d.save();
                ctx2d.globalAlpha = hudAlpha;

                // Top Azimuth Heading Scale
                const hdgW = Math.min(340, vw * 0.52);
                const hdgY = vw < 640 ? 64 : 68;
                const hdgBase = (t * 28 + smoothX * 30);
                ctx2d.strokeStyle = 'rgba(56, 189, 248, 0.4)';
                ctx2d.fillStyle = 'rgba(125, 211, 252, 0.75)';
                ctx2d.font = '600 9px "JetBrains Mono", monospace';
                ctx2d.textAlign = 'center';
                ctx2d.beginPath();
                ctx2d.moveTo(vw / 2 - hdgW / 2, hdgY);
                ctx2d.lineTo(vw / 2 + hdgW / 2, hdgY);
                ctx2d.stroke();
                for (let degOff = -45; degOff <= 45; degOff += 15) {
                    const bx = vw / 2 + (degOff / 45) * (hdgW / 2);
                    const val = ((Math.round(hdgBase + degOff) % 360) + 360) % 360;
                    ctx2d.beginPath();
                    ctx2d.moveTo(bx, hdgY - 4);
                    ctx2d.lineTo(bx, hdgY + 3);
                    ctx2d.stroke();
                    if (degOff % 30 === 0) ctx2d.fillText(String(val).padStart(3, '0') + '°', bx, hdgY - 8);
                }
                // Center caret indicator
                ctx2d.fillStyle = '#ff8a1f';
                ctx2d.beginPath();
                ctx2d.moveTo(vw / 2, hdgY + 4);
                ctx2d.lineTo(vw / 2 - 4, hdgY + 10);
                ctx2d.lineTo(vw / 2 + 4, hdgY + 10);
                ctx2d.closePath();
                ctx2d.fill();

                // Desktop Flanking Peripheral Telemetry Wings (cleanly hidden on narrow screens so mobile stays spacious)
                const wingFade = easeOutCubic(clamp01((p - 0.42) / 0.22));
                if (vw >= 920 && wingFade > 0.02) {
                    ctx2d.globalAlpha = wingFade;
                    const wingW = 196;
                    const leftX = Math.max(38, cx - R * 1.55 - wingW - 36);
                    const rightX = Math.min(vw - wingW - 38, cx + R * 1.55 + 36);
                    const wingY = cy - 72;

                    // Left Wing: Arc Core Output & Harmonic Waveform
                    ctx2d.strokeStyle = 'rgba(56, 189, 248, 0.32)';
                    ctx2d.fillStyle = 'rgba(6, 14, 30, 0.52)';
                    ctx2d.lineWidth = 1;
                    ctx2d.beginPath();
                    ctx2d.roundRect(leftX, wingY, wingW, 134, 10);
                    ctx2d.fill();
                    ctx2d.stroke();

                    const gj = (Math.min(3.2, easeOutCubic(p / 0.8) * 3.2)).toFixed(2);
                    ctx2d.fillStyle = '#38bdf8';
                    ctx2d.textAlign = 'left';
                    ctx2d.font = '700 10px "JetBrains Mono", monospace';
                    ctx2d.fillText('ARC CORE OUTPUT', leftX + 12, wingY + 20);
                    ctx2d.fillStyle = '#fbbf24';
                    ctx2d.font = '800 16px "JetBrains Mono", monospace';
                    ctx2d.fillText(`${gj} GJ/s`, leftX + 12, wingY + 42);

                    // Live oscillating energy curve inside left wing
                    ctx2d.strokeStyle = '#ff8811';
                    ctx2d.lineWidth = 1.6;
                    ctx2d.beginPath();
                    for (let gx = 0; gx <= wingW - 24; gx += 4) {
                        const gy = wingY + 78 + Math.sin(gx * 0.09 + t * 8.5) * 11 * Math.cos(gx * 0.03 - t * 3);
                        if (gx === 0) ctx2d.moveTo(leftX + 12 + gx, gy);
                        else ctx2d.lineTo(leftX + 12 + gx, gy);
                    }
                    ctx2d.stroke();

                    ctx2d.fillStyle = '#94a3b8';
                    ctx2d.font = '600 9px "JetBrains Mono", monospace';
                    ctx2d.fillText('AUX: OK   OPTIC: 99.8%', leftX + 12, wingY + 118);

                    // Right Wing: Tactical Threat Sweep Radar
                    ctx2d.fillStyle = 'rgba(6, 14, 30, 0.52)';
                    ctx2d.strokeStyle = 'rgba(56, 189, 248, 0.32)';
                    ctx2d.beginPath();
                    ctx2d.roundRect(rightX, wingY, wingW, 134, 10);
                    ctx2d.fill();
                    ctx2d.stroke();

                    ctx2d.fillStyle = '#38bdf8';
                    ctx2d.font = '700 10px "JetBrains Mono", monospace';
                    ctx2d.fillText('TACTICAL SCAN', rightX + 12, wingY + 20);

                    const rcx = rightX + wingW / 2;
                    const rcy = wingY + 74;
                    const rr = 38;
                    ctx2d.strokeStyle = 'rgba(56, 189, 248, 0.25)';
                    ctx2d.beginPath(); ctx2d.arc(rcx, rcy, rr, 0, Math.PI * 2); ctx2d.stroke();
                    ctx2d.beginPath(); ctx2d.arc(rcx, rcy, rr * 0.55, 0, Math.PI * 2); ctx2d.stroke();

                    const sweepA = t * 2.4;
                    ctx2d.strokeStyle = '#38bdf8';
                    ctx2d.lineWidth = 1.6;
                    ctx2d.beginPath();
                    ctx2d.moveTo(rcx, rcy);
                    ctx2d.lineTo(rcx + Math.cos(sweepA) * rr, rcy + Math.sin(sweepA) * rr);
                    ctx2d.stroke();

                    for (const bl of radarBlips) {
                        const bx = rcx + Math.cos(bl.ang) * (rr * bl.r);
                        const by = rcy + Math.sin(bl.ang) * (rr * bl.r);
                        const ping = 0.45 + 0.55 * Math.abs(Math.sin(t * 4 + bl.ang));
                        ctx2d.fillStyle = `rgba(255, 123, 0, ${ping})`;
                        ctx2d.beginPath(); ctx2d.arc(bx, by, 2.8, 0, Math.PI * 2); ctx2d.fill();
                    }

                    ctx2d.fillStyle = '#34d399';
                    ctx2d.font = '600 9px "JetBrains Mono", monospace';
                    ctx2d.fillText('FACTION LINK: SYNCHRONIZED', rightX + 12, wingY + 122);
                }

                ctx2d.restore();
            }

            // 7. Perimeter Mark-85 Corner Brackets & Sweeping Laser Beam
            const bracketIn = easeOutCubic(clamp01((p - 0.06) / 0.26));
            const pad = (vw < 640 ? 14 : 34) + (1 - bracketIn) * 44;
            const bLen = vw < 640 ? 20 : 34;
            ctx2d.save();
            ctx2d.strokeStyle = 'rgba(56, 189, 248, 0.6)';
            ctx2d.lineWidth = 2;
            const corners = [
                [pad, pad + 32, 1, 1],
                [vw - pad, pad + 32, -1, 1],
                [pad, vh - pad - 20, 1, -1],
                [vw - pad, vh - pad - 20, -1, -1]
            ];
            for (const [bx, by, dx, dy] of corners) {
                ctx2d.beginPath();
                ctx2d.moveTo(bx, by + dy * bLen);
                ctx2d.lineTo(bx, by);
                ctx2d.lineTo(bx + dx * bLen, by);
                ctx2d.stroke();
            }

            if (scanY > 0) {
                const scanG = ctx2d.createLinearGradient(0, scanY, vw, scanY);
                scanG.addColorStop(0, 'rgba(56, 189, 248, 0)');
                scanG.addColorStop(0.5, 'rgba(56, 189, 248, 0.65)');
                scanG.addColorStop(1, 'rgba(56, 189, 248, 0)');
                ctx2d.strokeStyle = scanG;
                ctx2d.lineWidth = 1.6;
                ctx2d.beginPath();
                ctx2d.moveTo(0, scanY);
                ctx2d.lineTo(vw, scanY);
                ctx2d.stroke();
            }
            ctx2d.restore();

            // 8. Phase 4 Expansion Shockwave Ripple
            if (p >= 0.74 && p < 0.91) {
                const wave = (p - 0.74) / 0.17;
                ctx2d.save();
                ctx2d.globalCompositeOperation = 'lighter';
                ctx2d.strokeStyle = `rgba(255, 138, 31, ${(1 - wave) * 0.85})`;
                ctx2d.lineWidth = 4 * (1 - wave) + 1;
                ctx2d.beginPath();
                ctx2d.arc(cx, cy, R * (1.1 + wave * 3.1), 0, Math.PI * 2);
                ctx2d.stroke();
                ctx2d.strokeStyle = `rgba(56, 189, 248, ${(1 - wave) * 0.55})`;
                ctx2d.lineWidth = 2 * (1 - wave) + 0.5;
                ctx2d.beginPath();
                ctx2d.arc(cx, cy, R * (0.9 + wave * 2.4), 0, Math.PI * 2);
                ctx2d.stroke();
                ctx2d.restore();
            }

            ctx2d.restore();

            if (p >= 0.89 && !overlay.classList.contains('dissolving')) {
                dismissFridayIntro(false);
                return;
            }
            rafId = requestAnimationFrame(drawFrame);
        }

        function cleanup(immediate) {
            if (finished) return;
            finished = true;
            cancelAnimationFrame(rafId);
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('resize', resizeCanvas);
            document.removeEventListener('keydown', onKeyDown);
            audio.stop();
            clearBootGuard();

            if (immediate) {
                overlay.remove();
                activeSession = null;
                return;
            }

            overlay.classList.add('dissolving');
            overlay.style.pointerEvents = 'none';
            setTimeout(() => {
                overlay.remove();
                if (activeSession && activeSession.overlay === overlay) {
                    activeSession = null;
                }
            }, DISSOLVE_MS);
        }

        activeSession = { overlay, cleanup };
        rafId = requestAnimationFrame(drawFrame);
    }

    function dismissFridayIntro(immediate = false) {
        clearBootGuard();
        if (activeSession) {
            activeSession.cleanup(Boolean(immediate));
        } else {
            const orphan = document.getElementById('friday-intro-overlay');
            if (orphan) orphan.remove();
        }
    }

    window.playFridayIntro = playFridayIntro;
    window.dismissFridayIntro = dismissFridayIntro;

    function bootOnReady() {
        if (isWarboardPage() && isAutoIntroEnabled() && !hasNoIntroBypass()) {
            playFridayIntro({ force: false });
        } else {
            clearBootGuard();
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootOnReady, { once: true });
    } else {
        bootOnReady();
    }
})();
