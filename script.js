// ===== DOM ELEMENTS =====
const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const startButton = document.getElementById('startButton');
const statusElement = document.getElementById('status');
const cameraSelect = document.getElementById('cameraSelect');
const scanTimerHorizontal = document.getElementById('scanTimerHorizontal');
const scanTimerFillHorizontal = document.getElementById('scanTimerFillHorizontal');
const resultOverlay = document.getElementById('resultOverlay');
const resultImageLarge = document.getElementById('resultImageLarge');
const btnCelebrate = document.getElementById('btnCelebrate');
const btnContinue = document.getElementById('btnContinue');
const scanDurationSlider = document.getElementById('scanDuration');
const durationValue = document.getElementById('durationValue');

// ===== STATE =====
let detections = [];
let isScanning = false;
let modelsLoaded = false;
let animationFrameId = null;
let selectedDeviceId = null;
let scanDuration = 3000;

// ===== AUDIO =====
let audioCtx = null;
let suspenseNodes = [];

function getAC() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
}

function playBeep() {
    try {
        const ac = getAC();
        const o = ac.createOscillator();
        const g = ac.createGain();
        o.connect(g); g.connect(ac.destination);
        o.frequency.value = 880; o.type = 'sine';
        g.gain.setValueAtTime(0.2, ac.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.1);
        o.start(); o.stop(ac.currentTime + 0.1);
    } catch(e) {}
}

function startSuspenseMusic(duration) {
    try {
        const ac = getAC();
        suspenseNodes = [];
        const notes = [130, 146, 130, 146, 155, 130, 146, 155, 164, 174];
        const dSec = duration / 1000;
        let t = ac.currentTime + 0.05;
        let i = 0;
        while (t < ac.currentTime + dSec) {
            const prog = (t - ac.currentTime) / dSec;
            const bps = 4 + prog * 10;
            const blen = 1 / bps;
            const o = ac.createOscillator();
            const g = ac.createGain();
            o.connect(g); g.connect(ac.destination);
            o.type = i % 3 === 0 ? 'sawtooth' : 'sine';
            o.frequency.value = notes[i % notes.length] * (1 + prog * 0.4);
            g.gain.setValueAtTime(0, t);
            g.gain.linearRampToValueAtTime(0.12 + prog * 0.2, t + 0.015);
            g.gain.exponentialRampToValueAtTime(0.001, t + blen * 0.75);
            o.start(t); o.stop(t + blen);
            suspenseNodes.push(o);
            t += blen; i++;
        }
    } catch(e) {}
}

function stopSuspenseMusic() {
    suspenseNodes.forEach(n => { try { n.stop(); } catch(e) {} });
    suspenseNodes = [];
}

function playFanfare() {
    try {
        const ac = getAC();
        [[392,0],[392,0.13],[392,0.26],[311,0.39],[392,0.76]].forEach(([freq, start]) => {
            const o = ac.createOscillator();
            const g = ac.createGain();
            o.connect(g); g.connect(ac.destination);
            o.type = 'square'; o.frequency.value = freq;
            const t = ac.currentTime + start;
            g.gain.setValueAtTime(0, t);
            g.gain.linearRampToValueAtTime(0.3, t + 0.02);
            g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
            o.start(t); o.stop(t + 0.4);
        });
    } catch(e) {}
}

// ===== DEVICE DETECTION =====
function getDeviceInfo() {
    const ua = navigator.userAgent.toLowerCase();
    const isMobile = /iphone|ipod|android.*mobile/.test(ua);
    const isTablet = /ipad/.test(ua) || (/macintosh/.test(ua) && navigator.maxTouchPoints > 1) || /android(?!.*mobile)/.test(ua);
    const isIOS = /iphone|ipad|ipod/.test(ua) || (/macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    return { isMobile, isTablet, isIOS, isDesktop: !isMobile && !isTablet };
}

// ===== CAMERA LIST =====
async function listCameras() {
    try {
        const dev = getDeviceInfo();
        // Xin quyền trước
        const s = await navigator.mediaDevices.getUserMedia({ video: true });
        s.getTracks().forEach(t => t.stop());

        const devices = await navigator.mediaDevices.enumerateDevices();
        const cams = devices.filter(d => d.kind === 'videoinput');
        if (!cams.length) throw new Error('Không tìm thấy camera');

        cameraSelect.innerHTML = '';

        if (dev.isMobile || dev.isTablet) {
            cameraSelect.innerHTML = `
                <option value="environment">📷 Camera Sau (Khuyến nghị)</option>
                <option value="user">🤳 Camera Trước</option>`;
            selectedDeviceId = 'environment';
        } else {
            const sorted = cams.map((c, i) => {
                const lbl = (c.label || `Camera ${i+1}`).toLowerCase();
                let p = 1, icon = '🎥';
                if (/usb|external|webcam|logitech|brio|c920|c922|elgato/.test(lbl)) { p = 3; icon = '🎥'; }
                else if (/back|rear/.test(lbl)) { p = 2; icon = '📷'; }
                else if (/front|facetime|built.in|internal|integrated/.test(lbl)) { p = 1; icon = '🤳'; }
                return { id: c.deviceId, label: `${icon} ${c.label || 'Camera '+(i+1)}`, p };
            }).sort((a,b) => b.p - a.p);

            sorted.forEach(c => {
                const o = document.createElement('option');
                o.value = c.id; o.textContent = c.label + (c.p === 3 ? ' (Khuyến nghị)' : '');
                cameraSelect.appendChild(o);
            });
            selectedDeviceId = sorted[0].id;
            cameraSelect.value = selectedDeviceId;
        }
    } catch(err) {
        statusElement.textContent = '❌ Lỗi camera: ' + err.message;
        statusElement.style.color = '#f00';
    }
}

// ===== START CAMERA =====
async function startCamera(deviceIdOrMode) {
    try {
        if (video.srcObject) {
            video.srcObject.getTracks().forEach(t => t.stop());
            video.srcObject = null;
        }

        const dev = getDeviceInfo();
        const isFacingMode = deviceIdOrMode === 'environment' || deviceIdOrMode === 'user';

        // Thử lần lượt từ tốt nhất → đơn giản nhất
        const attempts = [];

        if (isFacingMode) {
            // Mobile/Tablet
            if (!dev.isIOS) {
                attempts.push({ facingMode: { exact: deviceIdOrMode }, width: { ideal: 1920 }, height: { ideal: 1080 } });
            }
            attempts.push({ facingMode: deviceIdOrMode, width: { ideal: 1920 }, height: { ideal: 1080 } });
            attempts.push({ facingMode: deviceIdOrMode });
        } else {
            // Desktop/Laptop — KHÔNG dùng exact deviceId trong fallback vì dễ fail
            if (deviceIdOrMode) {
                attempts.push({ deviceId: { exact: deviceIdOrMode }, width: { ideal: 1920 }, height: { ideal: 1080 } });
                attempts.push({ deviceId: { exact: deviceIdOrMode } });
            }
            // Fallback cuối: bất kỳ camera nào
            attempts.push({ width: { ideal: 1280 }, height: { ideal: 720 } });
            attempts.push(true);
        }

        let stream = null;
        for (const constraint of attempts) {
            try {
                stream = await navigator.mediaDevices.getUserMedia({ video: constraint });
                console.log('✅ Camera OK với constraint:', constraint);
                break;
            } catch(e) {
                console.warn('⚠️ Thử constraint thất bại:', e.name, constraint);
            }
        }

        if (!stream) throw new Error('Không thể mở camera sau tất cả các lần thử');

        video.srcObject = stream;

        await new Promise(resolve => {
            video.onloadedmetadata = () => {
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                const t = stream.getVideoTracks()[0].getSettings();
                statusElement.textContent = `✅ Camera: ${video.videoWidth}x${video.videoHeight} @ ${Math.round(t.frameRate||30)}fps`;
                statusElement.style.color = '#0f0';
                resolve();
            };
            setTimeout(resolve, 4000);
        });

        if (!canvas.width && video.videoWidth) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
        }

    } catch(err) {
        console.error('Camera error:', err);
        statusElement.textContent = '❌ Không thể mở camera: ' + err.message;
        statusElement.style.color = '#f00';
    }
}

// ===== LOAD MODELS =====
async function loadModels() {
    try {
        statusElement.textContent = '⚡ Đang tải AI...';
        statusElement.className = 'status loading';
        const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.12/model';
        await Promise.all([
            faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
            faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL)
        ]);
        modelsLoaded = true;
        statusElement.className = 'status';
        statusElement.textContent = '✅ AI sẵn sàng! Nhấn BẮT ĐẦU QUÉT.';
        statusElement.style.color = '#0f0';
        startButton.disabled = false;
    } catch(err) {
        statusElement.textContent = '❌ Lỗi tải AI: ' + err.message;
        statusElement.style.color = '#f00';
    }
}

// ===== EXPAND BOX =====
function expandBox(box) {
    const nx = box.x - box.width * 0.6;
    const ny = box.y - box.height * 0.55;
    const nw = box.width * 2.2;
    const nh = box.height * 2.65;
    return {
        x: Math.max(0, nx),
        y: Math.max(0, ny),
        width: Math.min(nw, canvas.width - Math.max(0, nx)),
        height: Math.min(nh, canvas.height - Math.max(0, ny))
    };
}

// ===== DETECT FACES (multi-scale) =====
async function detectAtScale(scale) {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return [];
    const w = Math.round(vw * scale), h = Math.round(vh * scale);
    const off = document.createElement('canvas');
    off.width = w; off.height = h;
    const octx = off.getContext('2d');
    octx.filter = 'contrast(1.3) brightness(1.1)';
    octx.drawImage(video, 0, 0, w, h);
    const opts = new faceapi.SsdMobilenetv1Options({ minConfidence: 0.25, maxResults: 50 });
    const results = await faceapi.detectAllFaces(off, opts);
    return results.map(d => ({
        score: d.score,
        box: { x: d.box.x/scale, y: d.box.y/scale, width: d.box.width/scale, height: d.box.height/scale }
    }));
}

function iou(a, b) {
    const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
    const x2 = Math.min(a.x+a.width, b.x+b.width), y2 = Math.min(a.y+a.height, b.y+b.height);
    const inter = Math.max(0, x2-x1) * Math.max(0, y2-y1);
    const union = a.width*a.height + b.width*b.height - inter;
    return union > 0 ? inter/union : 0;
}

function mergeDetections(all) {
    const sorted = all.slice().sort((a,b) => b.score - a.score);
    const kept = [];
    for (const d of sorted) {
        if (!kept.some(k => iou(k.box, d.box) > 0.4)) kept.push(d);
    }
    return kept;
}

async function detectFaces() {
    if (!modelsLoaded || !video.videoWidth) {
        animationFrameId = requestAnimationFrame(detectFaces);
        return;
    }
    try {
        const [r1, r2, r3] = await Promise.all([
            detectAtScale(1.0),
            detectAtScale(1.5),
            detectAtScale(2.2)
        ]);
        detections = mergeDetections([...r1, ...r2, ...r3]);

        if (!isScanning) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            detections.forEach((d, i) => {
                const b = expandBox(d.box);
                ctx.strokeStyle = '#f00';
                ctx.lineWidth = 3;
                ctx.shadowBlur = 15;
                ctx.shadowColor = '#f00';
                ctx.strokeRect(b.x, b.y, b.width, b.height);
                ctx.shadowBlur = 0;
                ctx.fillStyle = '#f00';
                ctx.font = 'bold 14px Courier New';
                ctx.fillText(`#${i+1}`, b.x+5, b.y+20);
            });
            if (detections.length > 0) {
                ctx.fillStyle = '#0ff';
                ctx.font = 'bold 16px Courier New';
                ctx.shadowBlur = 8; ctx.shadowColor = '#0ff';
                ctx.fillText(`👥 ${detections.length} người`, 10, canvas.height - 10);
                ctx.shadowBlur = 0;
            }
        }
    } catch(e) {
        console.error('Detection error:', e);
    }
    animationFrameId = requestAnimationFrame(detectFaces);
}

// ===== SCAN =====
function startRandomSelection() {
    if (detections.length === 0) {
        alert('⚠️ Không phát hiện khuôn mặt nào!');
        return;
    }
    isScanning = true;
    startButton.disabled = true;
    scanDurationSlider.disabled = true;
    statusElement.textContent = `🎯 ĐANG QUÉT... ${detections.length} khuôn mặt`;
    statusElement.style.color = '#f00';

    playBeep();
    startSuspenseMusic(scanDuration);

    scanTimerHorizontal.style.display = 'block';
    scanTimerFillHorizontal.style.width = '0%';

    const duration = scanDuration;
    const t0 = performance.now();
    let targetIdx = -1;
    let lastHop = t0;
    let hopInterval = 80;

    function frame(now) {
        const elapsed = now - t0;
        const progress = Math.min(elapsed / duration, 1);

        hopInterval = progress < 0.7 ? 80 : progress < 0.9 ? 150 : 300 + (progress - 0.9) * 2000;

        if (now - lastHop > hopInterval) {
            targetIdx = Math.floor(Math.random() * detections.length);
            lastHop = now;
        }

        scanTimerFillHorizontal.style.width = (progress * 100) + '%';
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        detections.forEach((d, i) => {
            const b = expandBox(d.box);
            const isTarget = i === targetIdx;
            let color = '#f00';
            if (isTarget) {
                color = progress > 0.9 ? '#ff0' : progress > 0.7 ? '#0f0' : '#0ff';
            }
            ctx.strokeStyle = color;
            ctx.lineWidth = isTarget ? 4 : 3;
            ctx.shadowBlur = isTarget ? 20 : 15;
            ctx.shadowColor = color;
            ctx.strokeRect(b.x, b.y, b.width, b.height);
            ctx.shadowBlur = 0;
        });

        // Crosshair trên target
        if (targetIdx >= 0 && targetIdx < detections.length) {
            const b = expandBox(detections[targetIdx].box);
            const cx = b.x + b.width/2, cy = b.y + b.height/2;
            const sz = Math.max(b.width, b.height) * 0.8;
            const color = progress > 0.9 ? '#ff0' : progress > 0.7 ? '#0f0' : '#0ff';
            ctx.strokeStyle = color; ctx.lineWidth = 4;
            ctx.shadowBlur = 20; ctx.shadowColor = color;
            ctx.beginPath();
            ctx.moveTo(cx - sz/2, cy); ctx.lineTo(cx + sz/2, cy);
            ctx.moveTo(cx, cy - sz/2); ctx.lineTo(cx, cy + sz/2);
            ctx.stroke();
            ctx.beginPath(); ctx.arc(cx, cy, sz/2, 0, Math.PI*2); ctx.stroke();
            ctx.shadowBlur = 0;
        }

        if (progress < 1) {
            requestAnimationFrame(frame);
        } else {
            scanTimerFillHorizontal.style.width = '100%';
            scanTimerHorizontal.style.display = 'none';
            finishSelection(targetIdx >= 0 ? targetIdx : Math.floor(Math.random() * detections.length));
        }
    }
    requestAnimationFrame(frame);
}

// ===== FINISH =====
function finishSelection(finalIdx) {
    stopSuspenseMusic();
    playFanfare();

    if (detections.length === 0 || finalIdx < 0 || finalIdx >= detections.length) {
        isScanning = false;
        startButton.disabled = false;
        scanDurationSlider.disabled = false;
        return;
    }

    const box = expandBox(detections[finalIdx].box);

    // Crop ảnh từ video (canvas = video resolution → tọa độ khớp 1:1)
    const tmp = document.createElement('canvas');
    tmp.width = Math.round(box.width * 1.5);
    tmp.height = Math.round(box.height * 1.5);
    const tctx = tmp.getContext('2d');
    tctx.imageSmoothingEnabled = true;
    tctx.imageSmoothingQuality = 'high';
    tctx.drawImage(video, box.x, box.y, box.width, box.height, 0, 0, tmp.width, tmp.height);
    resultImageLarge.src = tmp.toDataURL('image/jpeg', 0.95);
    resultOverlay.style.display = 'flex';

    statusElement.textContent = '✅ ĐÃ CHỌN XONG!';
    statusElement.style.color = '#0f0';

    // Blink
    let blinks = 0;
    const blink = setInterval(() => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        detections.forEach((d, i) => {
            const b = expandBox(d.box);
            if (i === finalIdx) {
                ctx.strokeStyle = blinks % 2 === 0 ? '#0f0' : '#ff0';
                ctx.lineWidth = 6; ctx.shadowBlur = 30;
                ctx.shadowColor = blinks % 2 === 0 ? '#0f0' : '#ff0';
            } else {
                ctx.strokeStyle = '#f00'; ctx.lineWidth = 3;
                ctx.shadowBlur = 15; ctx.shadowColor = '#f00';
            }
            ctx.strokeRect(b.x, b.y, b.width, b.height);
            ctx.shadowBlur = 0;
        });
        if (++blinks >= 4) { clearInterval(blink); isScanning = false; }
    }, 100);
}

// ===== EVENTS =====
btnCelebrate.addEventListener('click', () => alert('🎉 Chúc mừng bạn đã được chọn! 🎉'));

btnContinue.addEventListener('click', () => {
    resultOverlay.style.display = 'none';
    startButton.disabled = false;
    scanDurationSlider.disabled = false;
    statusElement.textContent = '✅ AI sẵn sàng! Nhấn BẮT ĐẦU QUÉT.';
    statusElement.style.color = '#0f0';
});

cameraSelect.addEventListener('change', async (e) => {
    selectedDeviceId = e.target.value;
    statusElement.textContent = '🔄 Đang chuyển camera...';
    statusElement.style.color = '#ff0';
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    await startCamera(selectedDeviceId);
    detectFaces();
});

scanDurationSlider.addEventListener('input', (e) => {
    scanDuration = parseFloat(e.target.value) * 1000;
    durationValue.textContent = e.target.value;
});

startButton.addEventListener('click', startRandomSelection);

// Xoay màn hình → restart camera + đổi text nút
const orientationHandler = async () => {
    if (!selectedDeviceId) return;
    // Đổi text nút theo orientation
    const isLandscape = window.innerWidth > window.innerHeight;
    startButton.textContent = isLandscape ? 'BẮT ĐẦU' : 'BẮT ĐẦU QUÉT';

    setTimeout(async () => {
        if (animationFrameId) cancelAnimationFrame(animationFrameId);
        await startCamera(selectedDeviceId);
        detectFaces();
    }, 400);
};
if (screen.orientation) screen.orientation.addEventListener('change', orientationHandler);
else window.addEventListener('orientationchange', orientationHandler);

// Camera ngoài cắm vào
navigator.mediaDevices.addEventListener('devicechange', async () => {
    const prev = selectedDeviceId;
    await listCameras();
    if (Array.from(cameraSelect.options).some(o => o.value === prev)) {
        selectedDeviceId = prev;
        cameraSelect.value = prev;
    }
});

// ===== INIT =====
async function init() {
    statusElement.textContent = '⚡ Đang khởi động...';
    // Set text nút theo orientation hiện tại
    const isLandscape = window.innerWidth > window.innerHeight;
    startButton.textContent = isLandscape ? 'BẮT ĐẦU' : 'BẮT ĐẦU QUÉT';
    await listCameras();
    await startCamera(selectedDeviceId);
    await loadModels();
    detectFaces();
}

window.addEventListener('load', init);
