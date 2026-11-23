/**
 * FactionOS — F.R.I.D.A.Y. Mark-85 Cinema Optical Visor Boot Engine (~6.8s, 60fps GPU)
 *
 * Architecture:
 * - Layer 1 (GPU WebGL Fragment Shader): Volumetric fBM arc-plasma core, ACES Filmic HDR
 *   optical bloom, chromatic aberration, crepuscular god rays, bokeh motes, and curved
 *   helmet visor shutter ignition — single quad draw call at ~1-2ms/frame (60fps locked).
 * - Layer 2 (Lightweight 2D Overlay, zero shadowBlur): Crisp floating F.R.I.D.A.Y. wordmark,
 *   operative greeting, and minimal optical hairlines over free air (no chunky boxes).
 * - Layer 3 (WebAudio + Speech): Mechanical titanium faceplate clamp, turbine swell, harmonic
 *   resolve chord, and F.R.I.D.A.Y. spoken welcome with autoplay-safe unlock & mute toggle.
 */
(function () {
    'use strict';

    if (window.__fridayIntroEngineLoaded) return;
    window.__fridayIntroEngineLoaded = true;

    const PREF_ENABLED_KEY = 'sv_intro_enabled';
    const PREF_SOUND_KEY = 'sv_intro_sound';
    const DURATION_MS = 6800;
    const DISSOLVE_MS = 520;

    let activeSession = null;

    function isWarboardPage() {
        const p = (window.location.pathname || '/').toLowerCase();
        return p === '/' || p === '/index.html' || p === '';
    }

    function isAutoIntroEnabled() {
        try { return localStorage.getItem(PREF_ENABLED_KEY) !== '0'; } catch (_) { return true; }
    }

    function isSoundEnabled() {
        try { return localStorage.getItem(PREF_SOUND_KEY) !== '0'; } catch (_) { return true; }
    }

    function hasNoIntroBypass() {
        try {
            const params = new URLSearchParams(window.location.search || '');
            if (params.get('no_intro') === '1' || params.get('skip_intro') === '1') return true;
        } catch (_) {}
        try {
            if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return true;
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
            factionLabel: fname ? String(fname) : (fid && fid !== '0' ? `Faction #${fid}` : 'SPIDER-VERSE')
        };
    }

    function createAudioEngine() {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        let ctx = null;
        let master = null;
        let blockedByAutoplay = false;
        let closed = false;
        let spokeGreeting = false;
        let voiceSpeakingUntil = 0;
        const playedStage = {};

        function ensureContext() {
            if (closed || !AudioCtx) return null;
            if (!ctx) {
                ctx = new AudioCtx();
                master = ctx.createGain();
                master.gain.value = 0.34;
                master.connect(ctx.destination);
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

        function playTone(freqStart, freqEnd, duration, type, gainPeak, delay = 0, cutoffStart = null, cutoffEnd = null) {
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

            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(cutoffStart || 1400, now);
            if (cutoffEnd) filter.frequency.exponentialRampToValueAtTime(Math.max(40, cutoffEnd), now + duration * 0.88);

            g.gain.setValueAtTime(0.0001, now);
            g.gain.exponentialRampToValueAtTime(gainPeak, now + Math.min(0.08, duration * 0.25));
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
                data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.32));
            }
            const src = ctx.createBufferSource();
            src.buffer = buffer;
            const filter = ctx.createBiquadFilter();
            filter.type = 'bandpass';
            filter.frequency.value = centerFreq;
            filter.Q.value = 2.6;
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
                playServoNoise(0.26, 860, 0.28, 0.06);
                playTone(98, 30, 0.32, 'sine', 0.36, 0.08, 280, 55);
                playTone(40, 118, 2.5, 'sawtooth', 0.14, 0.25, 160, 1450);
                playTone(80, 175, 2.2, 'triangle', 0.11, 0.3, 300, 1150);
            } else if (stageNum === 2) {
                playTone(1318, 1760, 0.14, 'sine', 0.06, 0, 2600, 1800);
                playTone(1975, 2349, 0.1, 'sine', 0.05, 0.14, 3000, 2000);
                playServoNoise(0.14, 2100, 0.07, 0.2);
            } else if (stageNum === 3) {
                playTone(880, 1318, 0.16, 'sine', 0.065, 0, 2400, 1400);
                speakGreeting(operative);
            } else if (stageNum === 4) {
                [196, 293.66, 369.99, 440, 587.33].forEach((f, idx) => {
                    playTone(f, f * 1.003, 1.45, 'triangle', 0.05, idx * 0.04, 1900, 620);
                });
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
                    ? `Friday online. Welcome back, ${operative.playerName}. Warboard systems armed.`
                    : `Friday Mark eighty-five online. All systems armed.`;
                const utter = new SpeechSynthesisUtterance(phrase);
                utter.rate = 1.02;
                utter.pitch = 1.04;
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

        function stop() {
            closed = true;
            voiceSpeakingUntil = 0;
            try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (_) {}
            if (master && ctx) {
                try {
                    const t = ctx.currentTime;
                    master.gain.setValueAtTime(master.gain.value, t);
                    master.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
                } catch (_) {}
            }
            setTimeout(() => {
                if (ctx && ctx.state !== 'closed') { try { ctx.close(); } catch (_) {} }
                ctx = null;
            }, 240);
        }

        return {
            unlock,
            triggerStage,
            isBlocked: () => blockedByAutoplay && isSoundEnabled(),
            isSpeaking: () => performance.now() < voiceSpeakingUntil,
            stop
        };
    }

    function createWebGLRenderer(glCanvas) {
        let gl = null;
        try {
            gl = glCanvas.getContext('webgl2', { alpha: false, antialias: false, powerPreference: 'high-performance' })
                || glCanvas.getContext('webgl', { alpha: false, antialias: false, powerPreference: 'high-performance' });
        } catch (_) {}
        if (!gl) return null;

        const vsSrc = `
            attribute vec2 a_pos;
            void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
        `;

        const fsSrc = `
            precision highp float;
            uniform vec2 u_res;
            uniform float u_time;
            uniform float u_prog;
            uniform vec2 u_ptr;
            uniform vec2 u_centerOffset;
            uniform float u_speak;

            float hash(vec2 p) {
                return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
            }

            float noise(vec2 p) {
                vec2 i = floor(p);
                vec2 f = fract(p);
                vec2 u = f * f * (3.0 - 2.0 * f);
                return mix(
                    mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
                    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
                    u.y
                );
            }

            float fbm(vec2 p) {
                float v = 0.0;
                float a = 0.52;
                mat2 rot = mat2(0.80, 0.60, -0.60, 0.80);
                for (int i = 0; i < 3; i++) {
                    v += a * noise(p);
                    p = rot * p * 2.05;
                    a *= 0.5;
                }
                return v;
            }

            vec3 aces(vec3 x) {
                return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
            }

            float arcGlow(float r, float ang, float targetR, float rot, float segs, float duty, float thickness) {
                float d = abs(r - targetR);
                float baseGlow = thickness / (d * d * 95.0 + thickness * 0.45);
                float theta = mod(ang + rot, 6.2831853);
                float segAngle = 6.2831853 / segs;
                float sPos = mod(theta, segAngle) / segAngle;
                float mask = smoothstep(0.03, 0.09, sPos) * (1.0 - smoothstep(duty - 0.06, duty, sPos));
                return baseGlow * (0.14 + 0.86 * mask);
            }

            void main() {
                float minRes = min(u_res.x, u_res.y);
                vec2 uv = (gl_FragCoord.xy - 0.5 * u_res) / minRes;
                uv -= u_centerOffset;

                // Subtle helmet lens barrel curvature & parallax
                float rRaw = length(uv);
                vec2 p = uv * (1.0 + 0.065 * rRaw * rRaw) + u_ptr * 0.03;

                float r = length(p);
                float ang = atan(p.y, p.x);

                // Phase ramps
                float visorOpen = smoothstep(0.04, 0.24, u_prog);
                float coreAppear = smoothstep(0.06, 0.28, u_prog);
                float warmShift = smoothstep(0.42, 0.72, u_prog);
                float lockFlash = sin(smoothstep(0.74, 0.90, u_prog) * 3.14159265);

                vec3 cyan = vec3(0.14, 0.78, 1.00);
                vec3 amber = vec3(1.00, 0.47, 0.06);
                vec3 coreTint = mix(cyan, amber, warmShift);

                // 1. Deep sapphire helmet interior atmosphere + volumetric crepuscular rays
                vec3 col = vec3(0.006, 0.014, 0.032) * (1.0 - smoothstep(0.25, 1.25, r));
                float rayWave = pow(max(0.0, cos(ang * 7.0 - u_time * 0.45)), 3.0) * 0.55
                              + pow(max(0.0, cos(ang * 11.0 + u_time * 0.32)), 4.0) * 0.45;
                float godRays = rayWave * exp(-r * 3.2) * coreAppear * (0.18 + 0.14 * lockFlash);
                col += mix(cyan, amber, 0.45 * warmShift) * godRays;

                // 2. Swirling volumetric plasma energy inside core (computed ONLY inside core radius for speed!)
                float coreScale = mix(0.22, 1.0, coreAppear) * (1.0 + 0.015 * sin(u_time * 4.2));
                if (r < 0.62 * coreScale) {
                    vec2 q = p / max(0.05, coreScale) * 4.2;
                    float spin = u_time * 0.42;
                    mat2 m = mat2(cos(spin), -sin(spin), sin(spin), cos(spin));
                    q = m * q;
                    float n1 = fbm(q + vec2(u_time * 0.28, -u_time * 0.22));
                    float n2 = fbm(q * 1.45 - vec2(n1 * 1.4, u_time * 0.35));
                    float sphereMask = smoothstep(0.46, 0.04, r / max(0.05, coreScale));
                    float filaments = pow(clamp(1.0 - abs(n2 - 0.5) * 4.2, 0.0, 1.0), 2.2);
                    col += coreTint * sphereMask * (0.28 * n1 + 1.05 * filaments) * (1.0 + u_speak * 0.25);
                    col += mix(amber, cyan, warmShift) * sphereMask * n2 * 0.18;
                }

                // 3. Concentric HDR optical rings with radial chromatic aberration near edges
                float disp = 0.0028 * r;
                float rA = r / max(0.08, coreScale);

                float ringInner = arcGlow(rA, ang, 0.235,  u_time * 0.85, 2.0, 0.72, 0.0065);
                float ringGold  = arcGlow(rA, ang, 0.285, -u_time * 0.65, 3.0, 0.68, 0.0042);
                float ringOuter = arcGlow(rA, ang, 0.335,  u_time * 0.38, 4.0, 0.80, 0.0038);

                // Slight RGB dispersion offset on outer optical halo
                float ringEdgeR = arcGlow(rA - disp, ang, 0.385, -u_time * 0.25, 6.0, 0.52, 0.0022);
                float ringEdgeG = arcGlow(rA,        ang, 0.385, -u_time * 0.25, 6.0, 0.52, 0.0022);
                float ringEdgeB = arcGlow(rA + disp, ang, 0.385, -u_time * 0.25, 6.0, 0.52, 0.0022);

                // Optical notched compass ring inside shader (zero CPU paths!)
                float ticks = step(0.86, cos(ang * 72.0 + u_time * 16.0));
                float tickRing = (0.0025 / (abs(rA - 0.355) * 140.0 + 0.01)) * ticks * smoothstep(0.18, 0.38, u_prog);

                // Voice-reactive radial spectrum glow pulses
                float barAng = floor((ang + 3.14159265) / 6.2831853 * 64.0);
                float barAmp = 0.012 + 0.024 * abs(sin(barAng * 0.7 + u_time * (5.2 + u_speak * 8.0)));
                float inBarBand = smoothstep(0.40, 0.405, rA) * (1.0 - smoothstep(0.405 + barAmp, 0.415 + barAmp, rA));
                float barLine = smoothstep(0.65, 0.92, cos(ang * 64.0));
                float barsGlow = inBarBand * barLine * smoothstep(0.24, 0.45, u_prog) * (0.45 + 0.4 * u_speak);

                col += amber * (ringInner * 1.15 + ringGold * 0.75) * coreAppear;
                col += cyan * (ringOuter * 0.95 + tickRing * 0.42 + barsGlow * 0.7) * coreAppear;
                col += vec3(ringEdgeR, ringEdgeG, ringEdgeB) * vec3(0.25, 0.75, 1.0) * 0.55 * coreAppear;

                // 4. Anamorphic horizontal cinema lens flare + expanding EMP shockwave
                float flareAmt = sin(smoothstep(0.08, 0.32, u_prog) * 3.14159265) * 0.55 + lockFlash * 0.95;
                float anamorphic = exp(-abs(p.y) * 64.0) * exp(-abs(p.x) * 1.9) * flareAmt;
                col += mix(cyan, vec3(1.0, 0.88, 0.72), 0.55) * anamorphic * 0.85;

                if (u_prog > 0.74 && u_prog < 0.92) {
                    float wT = (u_prog - 0.74) / 0.18;
                    float wR = 0.28 + wT * 0.95;
                    float shock = exp(-abs(r - wR) * 48.0) * (1.0 - wT);
                    col += mix(amber, cyan, 0.4) * shock * 1.1;
                }

                // 5. Drifting out-of-focus optical bokeh motes (6 fast GPU spheres)
                for (int k = 0; k < 6; k++) {
                    float fk = float(k);
                    float bx = sin(fk * 2.17 + u_time * (0.14 + fk * 0.03)) * (0.36 + 0.1 * fk);
                    float by = cos(fk * 1.63 - u_time * (0.11 + fk * 0.025)) * (0.28 + 0.06 * fk);
                    float br = 0.022 + 0.008 * mod(fk, 3.0);
                    float bd = length(p - vec2(bx, by));
                    float bokeh = smoothstep(br, br * 0.35, bd) * 0.16 * coreAppear;
                    col += (mod(fk, 2.0) < 0.5 ? cyan : amber) * bokeh;
                }

                // 6. Metallic curved helmet visor eye-slit opening (Phase 1) + edge glint
                float edgeGap = mix(0.006, 0.88, visorOpen);
                float curvedSlit = abs(p.y) - edgeGap - 0.045 * (p.x * p.x);
                float visorMask = 1.0 - smoothstep(-0.015, 0.015, curvedSlit);
                float slitEdgeGlow = exp(-abs(curvedSlit) * 95.0) * (1.0 - visorOpen) * 1.3;
                col = col * visorMask + cyan * slitEdgeGlow;

                // Subtle diagonal curved glass reflection + outer helmet bezel vignette
                float glassReflect = exp(-pow((p.x * 0.6 + p.y * 0.9 - 0.35), 2.0) * 18.0) * 0.045 * visorOpen;
                col += vec3(0.5, 0.8, 1.0) * glassReflect;
                col *= (1.0 - smoothstep(0.65, 1.38, rRaw) * 0.72);

                // Subtle 35mm cinema film grain (imperceptible organic polish, breaks digital banding)
                float grain = (hash(gl_FragCoord.xy + fract(u_time) * 100.0) - 0.5) * 0.018;
                col += grain;

                col = aces(col * 1.18);
                gl_FragColor = vec4(pow(col, vec3(0.92)), 1.0);
            }
        `;

        function compile(type, src) {
            const sh = gl.createShader(type);
            gl.shaderSource(sh, src);
            gl.compileShader(sh);
            if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
                gl.deleteShader(sh);
                return null;
            }
            return sh;
        }

        const vs = compile(gl.VERTEX_SHADER, vsSrc);
        const fs = compile(gl.FRAGMENT_SHADER, fsSrc);
        if (!vs || !fs) return null;

        const prog = gl.createProgram();
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;

        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

        const posLoc = gl.getAttribLocation(prog, 'a_pos');
        const uRes = gl.getUniformLocation(prog, 'u_res');
        const uTime = gl.getUniformLocation(prog, 'u_time');
        const uProg = gl.getUniformLocation(prog, 'u_prog');
        const uPtr = gl.getUniformLocation(prog, 'u_ptr');
        const uOffset = gl.getUniformLocation(prog, 'u_centerOffset');
        const uSpeak = gl.getUniformLocation(prog, 'u_speak');

        return {
            resize(w, h, dpr) {
                glCanvas.width = Math.max(1, Math.floor(w * dpr));
                glCanvas.height = Math.max(1, Math.floor(h * dpr));
                gl.viewport(0, 0, glCanvas.width, glCanvas.height);
            },
            render(t, p, sx, sy, offsetY, speaking) {
                gl.useProgram(prog);
                gl.bindBuffer(gl.ARRAY_BUFFER, buf);
                gl.enableVertexAttribArray(posLoc);
                gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
                gl.uniform2f(uRes, glCanvas.width, glCanvas.height);
                gl.uniform1f(uTime, t);
                gl.uniform1f(uProg, p);
                gl.uniform2f(uPtr, sx, sy);
                gl.uniform2f(uOffset, 0.0, offsetY);
                gl.uniform1f(uSpeak, speaking ? 1.0 : 0.0);
                gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            },
            destroy() {
                try {
                    gl.deleteProgram(prog);
                    gl.deleteShader(vs);
                    gl.deleteShader(fs);
                    gl.deleteBuffer(buf);
                } catch (_) {}
            }
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
        overlay.setAttribute('aria-label', 'F.R.I.D.A.Y. Mark-85 Boot Sequence');

        overlay.innerHTML = `
            <canvas id="friday-intro-gl" class="friday-intro-canvas"></canvas>
            <canvas id="friday-intro-canvas" class="friday-intro-canvas"></canvas>
            <div class="friday-intro-hud-chrome">
                <div class="friday-intro-topline">
                    <span class="friday-intro-tag"><span class="fi-dot"></span> F.R.I.D.A.Y. // MK-85</span>
                    <span class="friday-intro-clock" id="friday-intro-subclock">INITIALIZING</span>
                </div>
                <div class="friday-intro-bottom">
                    <div class="friday-intro-console" id="friday-intro-console" aria-hidden="true"></div>
                    <div class="friday-intro-controls">
                        <button type="button" class="friday-intro-pill" id="friday-intro-audio-btn" aria-label="Toggle Stark Audio"></button>
                        <button type="button" class="friday-intro-pill" id="friday-intro-autohide-btn" aria-label="Toggle Auto-Play on Entry"></button>
                        <button type="button" class="friday-intro-skip" id="friday-intro-skip-btn">Skip →</button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);
        clearBootGuard();

        const glCanvas = overlay.querySelector('#friday-intro-gl');
        const txtCanvas = overlay.querySelector('#friday-intro-canvas');
        const ctx2d = txtCanvas.getContext('2d');
        const subClockEl = overlay.querySelector('#friday-intro-subclock');
        const consoleEl = overlay.querySelector('#friday-intro-console');
        const audioBtn = overlay.querySelector('#friday-intro-audio-btn');
        const autoBtn = overlay.querySelector('#friday-intro-autohide-btn');
        const skipBtn = overlay.querySelector('#friday-intro-skip-btn');

        const glRenderer = createWebGLRenderer(glCanvas);

        let vw = window.innerWidth;
        let vh = window.innerHeight;
        // Keep fragment fillrate ~1.05x DPR for zero-lag 60/120fps on Retina mobile & 4K, while text stays sharp at up to 2x DPR
        let glDpr = Math.min(window.devicePixelRatio || 1, 1.05);
        let txtDpr = Math.min(window.devicePixelRatio || 1, 2.0);

        function resizeAll() {
            vw = window.innerWidth;
            vh = window.innerHeight;
            glDpr = Math.min(window.devicePixelRatio || 1, 1.05);
            txtDpr = Math.min(window.devicePixelRatio || 1, 2.0);
            if (glRenderer) {
                glRenderer.resize(vw, vh, glDpr);
            } else {
                glCanvas.width = vw;
                glCanvas.height = vh;
            }
            txtCanvas.width = Math.max(1, Math.floor(vw * txtDpr));
            txtCanvas.height = Math.max(1, Math.floor(vh * txtDpr));
        }
        resizeAll();

        let pointerX = 0, pointerY = 0;
        let smoothX = 0, smoothY = 0;
        function onPointerMove(e) {
            if (!e) return;
            pointerX = ((e.clientX || vw / 2) / vw - 0.5) * 2;
            pointerY = ((e.clientY || vh / 2) / vh - 0.5) * 2;
        }
        window.addEventListener('pointermove', onPointerMove, { passive: true });
        window.addEventListener('resize', resizeAll);

        function syncControlLabels() {
            const soundOn = isSoundEnabled();
            if (audioBtn) {
                if (!soundOn) {
                    audioBtn.textContent = '🔇 Muted';
                    audioBtn.classList.remove('pulse');
                } else if (audio.isBlocked()) {
                    audioBtn.textContent = '🔊 Tap for Sound';
                    audioBtn.classList.add('pulse');
                } else {
                    audioBtn.textContent = '🔊 Stark Audio';
                    audioBtn.classList.remove('pulse');
                }
            }
            if (autoBtn) {
                const autoOn = isAutoIntroEnabled();
                autoBtn.textContent = autoOn ? 'Auto-Intro: ON' : 'Auto-Intro: OFF';
                autoBtn.classList.toggle('muted-pref', !autoOn);
            }
        }

        audio.unlock().then(() => { syncControlLabels(); });
        syncControlLabels();

        async function tryUnlockFromGesture(e) {
            if (e && e.target && (e.target.closest('#friday-intro-skip-btn') || e.target.closest('#friday-intro-autohide-btn') || e.target.closest('#friday-intro-audio-btn'))) return;
            if (isSoundEnabled() && audio.isBlocked()) {
                const ok = await audio.unlock();
                if (ok) {
                    const elapsed = performance.now() - startMs;
                    if (elapsed < 1200) audio.triggerStage(1, operative);
                    else if (elapsed < 3200) audio.triggerStage(2, operative);
                    else if (elapsed < 5100) audio.triggerStage(3, operative);
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

        // Single clean floating cinema telemetry status line (no chunky box)
        let consolePhase = -1;
        function updateFloatingTelemetry(p) {
            if (!consoleEl) return;
            let phase = 0;
            if (p >= 0.68) phase = 3;
            else if (p >= 0.40) phase = 2;
            else if (p >= 0.08) phase = 1;
            if (phase === consolePhase) return;
            consolePhase = phase;

            consoleEl.textContent = '';
            const span = document.createElement('span');
            span.className = 'fi-cinema-line';
            if (phase === 1) {
                span.textContent = 'OPTICAL VISOR CALIBRATING // ARC TURBINE NOMINAL';
            } else if (phase === 2) {
                span.textContent = `OPERATIVE: ${operative.playerName}${operative.playerId ? ` [${operative.playerId}]` : ''} // ${operative.factionLabel.toUpperCase()}`;
            } else if (phase === 3) {
                span.textContent = `${operative.authenticated ? 'BIOMETRIC MATCH CONFIRMED' : 'INTERFACE READY'} • WARBOARD TELEMETRY ARMED`;
                span.classList.add('locked');
            }
            if (phase > 0) consoleEl.appendChild(span);
        }

        let rafId = 0;
        let finished = false;
        let lastFrameMs = performance.now();
        let frameCount = 0;
        let frameDtSum = 0;
        const startMs = lastFrameMs;

        function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
        function easeOutCubic(t) { const x = clamp01(t); return 1 - Math.pow(1 - x, 3); }

        function drawFrame(now) {
            if (finished) return;
            const dt = now - lastFrameMs;
            lastFrameMs = now;
            if (dt > 0 && dt < 250) {
                frameCount++;
                frameDtSum += dt;
            }

            const elapsed = now - startMs;
            const p = Math.min(1, elapsed / DURATION_MS);
            const t = elapsed / 1000;

            smoothX += (pointerX - smoothX) * 0.09;
            smoothY += (pointerY - smoothY) * 0.09;

            // Camera impact shake impulses (at visor seal & lock flash)
            let shakePx = 0, shakePy = 0;
            if (elapsed > 140 && elapsed < 380) {
                const mag = (1 - (elapsed - 140) / 240) * 6;
                shakePx = (Math.random() - 0.5) * mag;
                shakePy = (Math.random() - 0.5) * mag;
            }

            if (p >= 0.01) audio.triggerStage(1, operative);
            if (p >= 0.24) audio.triggerStage(2, operative);
            if (p >= 0.48) audio.triggerStage(3, operative);
            if (p >= 0.74) audio.triggerStage(4, operative);

            updateFloatingTelemetry(p);
            if (subClockEl) {
                if (p < 0.22) subClockEl.textContent = 'OPTIC SEAL';
                else if (p < 0.72) subClockEl.textContent = `SYNC ${String(Math.min(99, Math.round((p / 0.74) * 100))).padStart(2, '0')}%`;
                else subClockEl.textContent = 'ARMED';
            }

            // 1. Hardware GPU WebGL Shader Pass (1 single draw call!)
            const offsetYGl = vw < 640 ? 0.11 : 0.05; // shift core slightly above center cleanly in GLSL (-Y in uv is down, +Y is up)
            if (glRenderer) {
                glRenderer.render(t, p, smoothX + shakePx * 0.01, -smoothY + shakePy * 0.01, offsetYGl, audio.isSpeaking());
            } else {
                // Lightweight clean Canvas 2D fallback only if WebGL unavailable
                const gctx = glCanvas.getContext('2d');
                if (gctx) {
                    const gr = gctx.createRadialGradient(vw / 2, vh * 0.44, 10, vw / 2, vh * 0.44, Math.min(vw, vh) * 0.5);
                    gr.addColorStop(0, '#0a2540');
                    gr.addColorStop(1, '#010308');
                    gctx.fillStyle = gr;
                    gctx.fillRect(0, 0, vw, vh);
                }
            }

            // 2. Crisp Lightweight Typography & Minimal Hairlines (<0.4ms total!)
            ctx2d.setTransform(txtDpr, 0, 0, txtDpr, 0, 0);
            ctx2d.clearRect(0, 0, vw, vh);

            const cy = (vw < 640 ? vh * 0.39 : vh * 0.45) + shakePy - smoothY * 8;
            const cx = vw * 0.5 + shakePx - smoothX * 8;
            const minDim = Math.min(vw, vh);
            const scaleR = Math.max(76, Math.min(182, minDim * 0.23));

            const txtAlpha = easeOutCubic((p - 0.14) / 0.22);
            if (txtAlpha > 0.02) {
                ctx2d.save();
                ctx2d.globalAlpha = txtAlpha;
                ctx2d.textAlign = 'center';
                ctx2d.textBaseline = 'middle';

                // Clean crisp holographic F.R.I.D.A.Y. wordmark with fast 1px depth backing (zero shadowBlur lag)
                const fSize = Math.round(scaleR * 0.25);
                ctx2d.font = `900 ${fSize}px "JetBrains Mono", ui-monospace, SFMono-Regular, monospace`;
                ctx2d.fillStyle = 'rgba(2, 6, 16, 0.55)';
                ctx2d.fillText('F.R.I.D.A.Y.', cx, cy - fSize * 0.14 + 2);
                ctx2d.fillStyle = '#ffffff';
                ctx2d.fillText('F.R.I.D.A.Y.', cx, cy - fSize * 0.14);

                const locked = p > 0.56;
                const subSize = Math.max(9, Math.round(scaleR * 0.07));
                const subTxt = p > 0.72
                    ? (operative.authenticated ? `WELCOME BACK, ${operative.playerName.toUpperCase()}` : 'SYSTEMS ARMED')
                    : 'MARK-85 TACTICAL INTERFACE';
                ctx2d.font = `700 ${subSize}px "Inter", system-ui, sans-serif`;
                ctx2d.fillStyle = 'rgba(2, 6, 16, 0.65)';
                ctx2d.fillText(subTxt, cx, cy + fSize * 0.68 + 1.5);
                ctx2d.fillStyle = locked ? 'rgba(254, 240, 199, 0.96)' : 'rgba(224, 242, 254, 0.95)';
                ctx2d.fillText(subTxt, cx, cy + fSize * 0.68);
                ctx2d.restore();
            }

            // Subtle hairline corner optics (only 4 short strokes, zero blur)
            const cornerA = easeOutCubic((p - 0.1) / 0.25) * 0.42;
            if (cornerA > 0.02) {
                const pad = vw < 640 ? 14 : 32;
                const len = vw < 640 ? 16 : 26;
                ctx2d.save();
                ctx2d.strokeStyle = `rgba(125, 211, 252, ${cornerA})`;
                ctx2d.lineWidth = 1.2;
                ctx2d.beginPath();
                ctx2d.moveTo(pad, pad + 26 + len); ctx2d.lineTo(pad, pad + 26); ctx2d.lineTo(pad + len, pad + 26);
                ctx2d.moveTo(vw - pad, pad + 26 + len); ctx2d.lineTo(vw - pad, pad + 26); ctx2d.lineTo(vw - pad - len, pad + 26);
                ctx2d.moveTo(pad, vh - pad - 18 - len); ctx2d.lineTo(pad, vh - pad - 18); ctx2d.lineTo(pad + len, vh - pad - 18);
                ctx2d.moveTo(vw - pad, vh - pad - 18 - len); ctx2d.lineTo(vw - pad, vh - pad - 18); ctx2d.lineTo(vw - pad - len, vh - pad - 18);
                ctx2d.stroke();
                ctx2d.restore();
            }

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
            window.removeEventListener('resize', resizeAll);
            document.removeEventListener('keydown', onKeyDown);
            audio.stop();
            clearBootGuard();

            if (frameCount > 0) {
                window.__fridayIntroLastMetrics = {
                    frames: frameCount,
                    avgFrameMs: Number((frameDtSum / frameCount).toFixed(2)),
                    usedWebGL: Boolean(glRenderer)
                };
            }

            if (immediate) {
                if (glRenderer) glRenderer.destroy();
                overlay.remove();
                activeSession = null;
                return;
            }

            overlay.classList.add('dissolving');
            overlay.style.pointerEvents = 'none';
            setTimeout(() => {
                if (glRenderer) glRenderer.destroy();
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
