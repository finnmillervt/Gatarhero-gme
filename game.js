
// Guitar Hero Lite — Advanced (single-file game logic)
// Controls: D F J K keys or click the lane buttons.

(() => {
	// Lazy audio context (created on user gesture to avoid autoplay blocks)
	const AudioCtx = window.AudioContext || window.webkitAudioContext;
	let audioCtx = null;
	function ensureAudio(){ if(!audioCtx) audioCtx = new AudioCtx(); }

	// DOM will be ready before we query elements
	document.addEventListener('DOMContentLoaded', ()=>{
		const canvas = document.getElementById('game-canvas');
		const ctx = canvas.getContext('2d');
		const W = 900, H = 600;
		// UI refs
		const scoreEl = document.getElementById('score-val');
		const comboEl = document.getElementById('combo-val');
		const multEl = document.getElementById('mult-val');
		const feedbackEl = document.getElementById('feedback');
		const startBtn = document.getElementById('start-btn');
		const startSongBtn = document.getElementById('start-song-btn');
		const randomBtn = document.getElementById('random-btn');
		const audioFileInput = document.getElementById('audio-file');
		const songAudio = document.getElementById('song-audio');
		const bpmInput = document.getElementById('bpm');
		const offsetInput = document.getElementById('offset');
		const genChartBtn = document.getElementById('gen-chart');
		const difficultySel = document.getElementById('difficulty');

		// Lanes
		const LANES = 4;
		const laneWidth = 160;
		const laneGap = 10;
		const laneX = Array.from({length: LANES}, (_,i)=> 50 + i*(laneWidth + laneGap));
		const hitY = H - 140; // y position of hit line

		// Game state
		let notes = []; // {lane, time, y, hit}
		let startTime = 0;
		let playing = false;
		let score = 0, combo = 0, multiplier = 1;
		let difficulty = 'medium';
		let currentTrack = null;

		// Timing and song data (simple tracks)
		const tracks = [
			{ name: 'Simple Beat', bpm: 90, pattern: generatePattern(60, [0,1,2,3], 0.5) },
			{ name: 'Syncopated', bpm: 120, pattern: generatePattern(80, [0,1,2,3], 0.35) },
			{ name: 'Rapid Fire', bpm: 150, pattern: generatePattern(100, [0,1,2,3], 0.22) }
		];

		function generatePattern(length, lanes, density=0.4){
			// generate a random sequence of note timings (seconds) and lanes
			const arr = [];
			let t = 0;
			while(arr.length < length){
				t += Math.random() * (1/density);
				if(Math.random() < density){
					arr.push({time: t, lane: lanes[Math.floor(Math.random()*lanes.length)]});
				}
			}
			return arr;
		}

		// Difficulty settings
		const DIFF = {
			easy: {hitWindow: 0.25, speed: 140},
			medium: {hitWindow: 0.18, speed: 220},
			hard: {hitWindow: 0.11, speed: 320}
		};

			// drawing helpers
			function roundRect(ctx, x, y, w, h, r){
				ctx.beginPath();
				ctx.moveTo(x + r, y);
				ctx.arcTo(x + w, y, x + w, y + h, r);
				ctx.arcTo(x + w, y + h, x, y + h, r);
				ctx.arcTo(x, y + h, x, y, r);
				ctx.arcTo(x, y, x + w, y, r);
				ctx.closePath();
				ctx.fill();
			}

			function playClick(freq=880, time=0, duration=0.06){
			ensureAudio();
			const o = audioCtx.createOscillator();
			const g = audioCtx.createGain();
			o.type = 'sine';
			o.frequency.value = freq;
			g.gain.value = 0.0001;
			o.connect(g); g.connect(audioCtx.destination);
			o.start(audioCtx.currentTime + time);
			g.gain.exponentialRampToValueAtTime(0.12, audioCtx.currentTime + time + 0.005);
			g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + time + duration);
			o.stop(audioCtx.currentTime + time + duration + 0.02);
		}

		// Convert track pattern to on-screen notes
		function loadTrack(track){
			notes = [];
			const startOffset = 2.0; // seconds before first note appears at spawn
			for(const n of track.pattern){
				const spawnTime = n.time - startOffset;
				notes.push({lane: n.lane, time: n.time, spawnTime, y: -50, hit: false});
			}
		}

			// Load an audio file into the <audio> element
			audioFileInput.addEventListener('change', (e)=>{
				const f = e.target.files && e.target.files[0];
				if(!f) return;
				const url = URL.createObjectURL(f);
				songAudio.src = url;
				songAudio.load();
				feedback(`Loaded ${f.name}`, 'info');
			});

			// Generate a simple chart from BPM and offset (every quarter note for demo)
			genChartBtn.addEventListener('click', ()=>{
				const bpm = Number(bpmInput.value) || 120;
				const offset = Number(offsetInput.value) || 0;
				const secondsPerBeat = 60 / bpm;
				// create pattern for 60 beats
				const pattern = [];
				for(let i=0;i<120;i++){
					const t = offset + i * secondsPerBeat * 0.5; // half-note density
					pattern.push({time: t, lane: Math.floor(Math.random()*LANES)});
				}
				currentTrack = { name: 'User generated', bpm, pattern };
				loadTrack(currentTrack);
				feedback('Chart generated', 'info');
			});

			function startGame(trackIndex=0){
				// start without audio (chart-only start)
				difficulty = difficultySel.value;
				if(!currentTrack) currentTrack = tracks[trackIndex];
				loadTrack(currentTrack);
				score = 0; combo = 0; multiplier = 1;
				updateUI();
				playing = true;
				startTime = performance.now()/1000;
				if(audioCtx) audioCtx.resume();
				feedback('Go!', 'info');
				requestAnimationFrame(loop);
			}

				// Particle system
				const particles = [];
				function spawnParticles(x,y,color){
					for(let i=0;i<18;i++){
						particles.push({ x, y, vx: (Math.random()-0.5)*6, vy: (Math.random()-1.8)*6, life: 0.9 + Math.random()*0.6, color });
					}
				}

				function updateParticles(dt){
					for(let i=particles.length-1;i>=0;i--){
						const p = particles[i];
						p.vy += 9.8 * dt; // gravity
						p.x += p.vx; p.y += p.vy; p.life -= dt;
						if(p.life <= 0) particles.splice(i,1);
					}
				}

				function drawParticles(ctx){
					for(const p of particles){
						ctx.globalAlpha = Math.max(0, Math.min(1, p.life));
						ctx.fillStyle = p.color;
						ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI*2); ctx.fill();
					}
					ctx.globalAlpha = 1;
				}

				function startWithSong(){
				if(!songAudio.src){ feedback('Please load an audio file first', 'miss'); return; }
				// ensure chart exists; if not, generate from bpm
				if(!currentTrack){
					genChartBtn.click();
				}
				// reset score and notes
				score = 0; combo = 0; multiplier = 1;
				loadTrack(currentTrack);
				updateUI();
				// play audio and use its currentTime for timing
				ensureAudio();
				// connect audio element to audioCtx to prevent autoplay blocking in some browsers
				try{ const srcNode = audioCtx.createMediaElementSource(songAudio); srcNode.connect(audioCtx.destination); }catch(e){}
				songAudio.currentTime = 0;
						songAudio.play().then(()=>{
							playing = true;
							// startTime aligns chart time 0 to audio.currentTime
							startTime = performance.now()/1000 - songAudio.currentTime;
							feedback('Playing song', 'info');
							requestAnimationFrame(loop);
						}).catch(err=>{ feedback('Unable to play audio (gesture required)', 'miss'); });
			}

		function endGame(){
			playing = false;
			feedback(`Finished — Score ${score}`, 'finish');
		}

		// Hit detection
		function tryHit(lane){
			if(!playing) return;
			const tNow = performance.now()/1000 - startTime;
			// find nearest un-hit note in lane
			let best = null; let bestDelta = Infinity;
			for(const n of notes){
				if(n.hit || n.lane !== lane) continue;
				const delta = Math.abs(n.time - tNow);
				if(delta < bestDelta){ bestDelta = delta; best = n; }
			}
			const win = DIFF[difficulty].hitWindow;
			if(best && bestDelta <= win){
				best.hit = true;
				// score
				if(bestDelta < win * 0.33){ score += 300 * multiplier; feedback('Perfect', 'perfect'); playClick(1200); combo++; }
				else if(bestDelta < win * 0.66){ score += 150 * multiplier; feedback('Great', 'great'); playClick(900); combo++; }
				else { score += 50 * multiplier; feedback('Good', 'good'); playClick(700); combo++; }
				if(combo > 0 && combo % 10 === 0) multiplier++;
			} else {
				combo = 0; multiplier = 1; feedback('Miss', 'miss'); playClick(200, 0, 0.12);
			}
			updateUI();
		}

		function updateUI(){
			scoreEl.textContent = score;
			comboEl.textContent = combo;
			multEl.textContent = multiplier;
		}

		// Visual feedback helper
		let fbTimer = null;
		function feedback(text, cls=''){
			feedbackEl.textContent = text;
			feedbackEl.className = cls;
			if(fbTimer) clearTimeout(fbTimer);
			fbTimer = setTimeout(()=>{ feedbackEl.textContent = ''; feedbackEl.className = ''; }, 700);
		}

		// Canvas scaling for high-DPI displays
		function setupCanvas(){
			const dpr = Math.max(1, window.devicePixelRatio || 1);
			canvas.width = W * dpr;
			canvas.height = H * dpr;
			canvas.style.width = W + 'px';
			canvas.style.height = H + 'px';
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		}
		setupCanvas();
		window.addEventListener('resize', setupCanvas);

		// Render loop
		function loop(){
			const tNow = performance.now()/1000 - startTime;

			ctx.clearRect(0,0,W,H);
			// draw lanes
			for(let i=0;i<LANES;i++){
				ctx.fillStyle = '#111';
				ctx.fillRect(laneX[i], 0, laneWidth, H);
				ctx.fillStyle = '#2c2c2c';
				for(let y=0;y<H;y+=40) ctx.fillRect(laneX[i]+laneWidth-6, y+20, 6, 20);
			}

			// hit line
			ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
			ctx.beginPath(); ctx.moveTo(40, hitY); ctx.lineTo(W-40, hitY); ctx.stroke();

			// notes update and draw
			let alive = false;
					for(const n of notes){
				const tPct = (tNow - n.spawnTime) / (n.time - n.spawnTime || 1);
				n.y = -100 + tPct * (hitY + 150);
				if(!n.hit && tNow > n.time + DIFF[difficulty].hitWindow + 0.6){
					n.hit = true; combo = 0; multiplier = 1; feedback('Miss', 'miss');
				}
						if(!n.hit && n.y < H+50){
							alive = true;
							const colors = ['#ff6b6b','#ffd86b','#7fbfff','#7be495'];
							const c = colors[n.lane];
							const nx = laneX[n.lane] + 12 + (laneWidth-24)/2;
							// rounded note
							ctx.fillStyle = c;
							roundRect(ctx, nx - (laneWidth-24)/2, n.y, laneWidth-24, 28, 8);
							// glow
							ctx.save(); ctx.filter = 'blur(6px)'; ctx.globalAlpha = 0.22; ctx.fillStyle = c; roundRect(ctx, nx - (laneWidth-24)/2, n.y, laneWidth-24, 28, 8); ctx.restore();
							ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.font = '14px sans-serif'; ctx.fillText(n.lane+1, nx-((laneWidth-24)/2)+10, n.y+19);
						}
			}

					// draw particles
					updateParticles(1/60);
					drawParticles(ctx);

					// update progress bar
					const progressBar = document.getElementById('progress-bar');
					if(progressBar){
						const lastTime = Math.max(0, ...notes.map(n=>n.time));
						const prog = Math.min(1, Math.max(0, (tNow) / (lastTime || 1)));
						progressBar.style.width = (prog*100) + '%';
					}

			const lastNoteTime = Math.max(0, ...notes.map(n=>n.time));
			if(tNow > lastNoteTime + 2 && !alive){ endGame(); return; }

			ctx.fillStyle = '#fff'; ctx.font = '18px monospace';
			ctx.fillText(`Score: ${score}`, W-220, 30);

			if(playing) requestAnimationFrame(loop);
		}

		// Input handling
		window.addEventListener('keydown', (e)=>{
			const key = e.key.toLowerCase();
			if(key === 'd') tryHit(0);
			if(key === 'f') tryHit(1);
			if(key === 'j') tryHit(2);
			if(key === 'k') tryHit(3);
		});

		// lane buttons
		document.querySelectorAll('.lane-btn').forEach(b=>{
			b.addEventListener('pointerdown', (ev)=>{ ev.preventDefault(); tryHit(Number(b.dataset.lane)); });
		});

		// Ensure audio context gets created/resumed on first user gesture
		function resumeAudioOnGesture(){
			ensureAudio();
			if(audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
			// remove listeners after first gesture
			['pointerdown','keydown','touchstart'].forEach(ev => window.removeEventListener(ev, resumeAudioOnGesture));
		}
		['pointerdown','keydown','touchstart'].forEach(ev => window.addEventListener(ev, resumeAudioOnGesture));

		startBtn.addEventListener('click', ()=> startGame(1));
		startSongBtn.addEventListener('click', ()=> startWithSong());
		randomBtn.addEventListener('click', ()=> startGame(Math.floor(Math.random()*tracks.length)));

		// expose a dev helper
		window._ghl = { startGame, tracks, playClick };
	});
})();

