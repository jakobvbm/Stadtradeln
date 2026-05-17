document.addEventListener('DOMContentLoaded', () => {
    const video = document.getElementById('videoElement');
    const canvas = document.getElementById('trackingCanvas');
    const ctx = canvas.getContext('2d');
    const statusOverlay = document.getElementById('statusOverlay');
    
    // UI Elements
    const startBtn = document.getElementById('startBtn');
    const videoUpload = document.getElementById('videoUpload');
    const domThresholdInput = document.getElementById('domThreshold');
    const fullscreenBtn = document.getElementById('fullscreenBtn');
    
    // Stats
    const pedalCountEl = document.getElementById('pedalCount');
    const distanceKmEl = document.getElementById('distanceKm');
    const fsPedalsEl = document.getElementById('fsPedals');
    const fsKmEl = document.getElementById('fsKm');

    // State
    let isTracking = false;
    let animationId = null;
    let domThresh = parseInt(domThresholdInput.value);

    // Audio Sounds (mit Cache-Buster, falls die Dateien überschrieben wurden)
    const tritteSound = new Audio('Sounds/100_tritte.mp3?v=' + Date.now());
    const kiloSound = new Audio('Sounds/1_kilometer.mp3?v=' + Date.now());
    let audioUnlocked = false;

    function unlockAudio() {
        if (audioUnlocked) return;
        [tritteSound, kiloSound].forEach(sound => {
            sound.volume = 0; // Kurz stumm schalten
            const playPromise = sound.play();
            if (playPromise !== undefined) {
                playPromise.then(() => {
                    sound.pause();
                    sound.currentTime = 0;
                    sound.volume = 1; // Lautstärke wiederherstellen
                }).catch(() => {
                    sound.volume = 1;
                });
            } else {
                sound.volume = 1;
            }
        });
        audioUnlocked = true;
        document.removeEventListener('touchstart', unlockAudio);
        document.removeEventListener('click', unlockAudio);
    }

    // Mobile Browser (insbesondere iOS) erfordern eine Benutzerinteraktion, um Audio abzuspielen.
    document.addEventListener('touchstart', unlockAudio);
    document.addEventListener('click', unlockAudio);

    // Tracking logic (Full Round Detection)
    let pedalState = 'UNKNOWN'; // 'UP', 'DOWN'
    let extremeY = -1;
    const HYSTERESIS = 45; // Erhöht von 15 auf 45, um halbe Umdrehungen und Zittern zu ignorieren
    
    let pedalStrokes = 0;
    let lastStrokeTime = 0;
    let lastKm = 0;

    // Listeners for sliders
    domThresholdInput.addEventListener('input', (e) => {
        domThresh = parseInt(e.target.value);
        document.getElementById('domVal').innerText = domThresh;
    });

    // Fullscreen Listener
    fullscreenBtn.addEventListener('click', () => {
        if (!document.fullscreenElement) {
            document.querySelector('.video-container').requestFullscreen().catch(err => {
                console.error(`Fehler beim Vollbild: ${err.message}`);
            });
        } else {
            document.exitFullscreen();
        }
    });

    // Start Webcam
    startBtn.addEventListener('click', async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ 
                video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } } 
            });
            video.srcObject = stream;
            video.play();
            statusOverlay.style.display = 'none';
            startBtn.innerText = "Kamera Aktiv";
            startBtn.classList.add('secondary');
            startBtn.classList.remove('primary');
        } catch (err) {
            console.error("Fehler beim Kamerazugriff: ", err);
            statusOverlay.innerText = "Kamerazugriff verweigert!";
        }
    });

    // Handle Video Upload
    videoUpload.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const url = URL.createObjectURL(file);
            video.srcObject = null;
            video.src = url;
            video.play();
            statusOverlay.style.display = 'none';
        }
    });

    // Setup Canvas on video play
    video.addEventListener('play', () => {
        canvas.width = video.clientWidth || 640;
        canvas.height = video.clientHeight || 480;
        if (!isTracking) {
            isTracking = true;
            track();
        }
    });

    // Adjust canvas size on resize
    window.addEventListener('resize', () => {
        canvas.width = video.clientWidth || 640;
        canvas.height = video.clientHeight || 480;
    });

    function track() {
        if (video.paused || video.ended) {
            isTracking = false;
            return;
        }

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // Draw current video frame to a hidden offscreen canvas to get pixel data
        const offscreen = document.createElement('canvas');
        offscreen.width = canvas.width;
        offscreen.height = canvas.height;
        const oCtx = offscreen.getContext('2d');
        oCtx.drawImage(video, 0, 0, canvas.width, canvas.height);

        const frameData = oCtx.getImageData(0, 0, canvas.width, canvas.height);
        const data = frameData.data;

        let totalX = 0;
        let totalY = 0;
        let redPixelCount = 0;

        // Step by 4 pixels to improve performance (stride)
        const step = 4;

        for (let y = 0; y < canvas.height; y += step) {
            for (let x = 0; x < canvas.width; x += step) {
                const index = (y * canvas.width + x) * 4;
                const r = data[index];
                const g = data[index + 1];
                const b = data[index + 2];

                // Detect red color (Robust Dominance Method)
                const maxGB = Math.max(g, b);
                const redDominance = r - maxGB;

                if (redDominance > domThresh) {
                    totalX += x;
                    totalY += y;
                    redPixelCount++;
                }
            }
        }

        if (redPixelCount > 20) { // Threshold to avoid noise
            const centerX = totalX / redPixelCount;
            const centerY = totalY / redPixelCount;

            // Draw tracking indicator (Black Cross)
            const crossSize = 20;
            ctx.beginPath();
            // Horizontal line
            ctx.moveTo(centerX - crossSize, centerY);
            ctx.lineTo(centerX + crossSize, centerY);
            // Vertical line
            ctx.moveTo(centerX, centerY - crossSize);
            ctx.lineTo(centerX, centerY + crossSize);
            ctx.lineWidth = 4;
            ctx.strokeStyle = '#000000'; // Black cross
            ctx.stroke();

            // Peak detection (Full Round counting)
            if (extremeY === -1) extremeY = centerY;

            if (pedalState === 'UNKNOWN') {
                if (centerY > extremeY + HYSTERESIS) {
                    pedalState = 'DOWN';
                    extremeY = centerY;
                } else if (centerY < extremeY - HYSTERESIS) {
                    pedalState = 'UP';
                    extremeY = centerY;
                }
            } else if (pedalState === 'DOWN') {
                if (centerY > extremeY) {
                    extremeY = centerY; // update lowest point
                } else if (centerY < extremeY - HYSTERESIS) {
                    pedalState = 'UP';
                    extremeY = centerY;
                }
            } else if (pedalState === 'UP') {
                if (centerY < extremeY) {
                    extremeY = centerY; // update highest point
                } else if (centerY > extremeY + HYSTERESIS) {
                    pedalState = 'DOWN';
                    extremeY = centerY;
                    registerStroke(); // A full round completed (passed top and going down)
                }
            }
        }

        animationId = requestAnimationFrame(track);
    }

    function registerStroke() {
        const now = Date.now();
        // Debounce erhöht auf 550ms, um versehentliche Doppelzählungen bei einer Umdrehung zu vermeiden
        if (now - lastStrokeTime > 550) {
            pedalStrokes++;
            pedalCountEl.innerText = pedalStrokes;
            fsPedalsEl.innerText = pedalStrokes;
            
            // 1 stroke = 3 meters = 0.003 km
            const distance = pedalStrokes * 0.003;
            const distanceStr = distance.toFixed(2);
            distanceKmEl.innerText = distanceStr;
            
            // In Fullscreen: Show meters instead of km
            const distanceMeters = Math.floor(pedalStrokes * 3);
            fsKmEl.innerText = distanceMeters;

            // Sound every 100 strokes
            if (pedalStrokes % 100 === 0 && pedalStrokes > 0) {
                tritteSound.currentTime = 0;
                tritteSound.play().catch(e => console.log("Audio play failed:", e));
            }

            // Sound every full Kilometer
            const currentKm = Math.floor(distance);
            if (currentKm > lastKm) {
                lastKm = currentKm;
                kiloSound.currentTime = 0;
                kiloSound.play().catch(e => console.log("Audio play failed:", e));
            }

            lastStrokeTime = now;

            // Pop animation on the stat card
            const highlightCard = document.querySelector('.stat-card.highlight');
            highlightCard.style.transform = 'scale(1.05)';
            setTimeout(() => {
                highlightCard.style.transform = 'scale(1)';
            }, 150);
        }
    }
});
