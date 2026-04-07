// ===== BIẾN TOÀN CỤC =====
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

let detections = [];
let isScanning = false;
let modelsLoaded = false;
let animationFrameId = null;
let selectedDeviceId = null;
let scanDuration = 3000;
let availableCameras = [];

// ===== ÂM THANH (lazy-init để tránh bị block trên iOS) =====
let audioContext = null;

function getAudioContext() {
    if (!audioContext) {
        audioContext = new (window.AudioContext || (window).webkitAudioContext)();
    }
    // Resume nếu bị suspended (iOS Safari yêu cầu user gesture)
    if (audioContext.state === 'suspended') {
        audioContext.resume();
    }
    return audioContext;
}

function playBeep() {
    try {
        const ac = getAudioContext();
        const osc = ac.createOscillator();
        const gain = ac.createGain();
        osc.connect(gain);
        gain.connect(ac.destination);
        osc.frequency.value = 800;
        osc.type = 'sine';
        gain.gain.setValueAtTime(0.3, ac.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ac.currentTime + 0.1);
        osc.start(ac.currentTime);
        osc.stop(ac.currentTime + 0.1);
    } catch (e) { /* bỏ qua lỗi âm thanh */ }
}

function playTing() {
    try {
        const ac = getAudioContext();
        const osc = ac.createOscillator();
        const gain = ac.createGain();
        osc.connect(gain);
        gain.connect(ac.destination);
        osc.frequency.value = 1200;
        osc.type = 'sine';
        gain.gain.setValueAtTime(0.5, ac.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ac.currentTime + 0.3);
        osc.start(ac.currentTime);
        osc.stop(ac.currentTime + 0.3);
    } catch (e) { /* bỏ qua lỗi âm thanh */ }
}

// ===== PHÁT HIỆN THIẾT BỊ =====
function detectDeviceType() {
    const ua = navigator.userAgent.toLowerCase();
    const isMobile = /iphone|ipod|android.*mobile/.test(ua);
    // iPad iOS 13+ báo cáo là MacIntel nên kiểm tra thêm maxTouchPoints
    const isTablet = /ipad/.test(ua) ||
        (/macintosh/.test(ua) && navigator.maxTouchPoints > 1) ||
        /android(?!.*mobile)/.test(ua);
    const isDesktop = !isMobile && !isTablet;
    return {
        isMobile,
        isTablet,
        isDesktop,
        isIOS: /iphone|ipad|ipod/.test(ua) || (/macintosh/.test(ua) && navigator.maxTouchPoints > 1),
        isAndroid: /android/.test(ua)
    };
}

// ===== LIỆT KÊ CAMERA =====
async function listCameras() {
    try {
        const deviceInfo = detectDeviceType();
        console.log('📱 Thiết bị:', deviceInfo);

        // Yêu cầu quyền trước (không dùng exact để tránh lỗi trên iOS)
        const initConstraints = {
            video: {
                facingMode: (deviceInfo.isMobile || deviceInfo.isTablet) ? 'environment' : 'user'
            }
        };
        const initStream = await navigator.mediaDevices.getUserMedia(initConstraints);
        // Dừng stream tạm này ngay sau khi có quyền
        initStream.getTracks().forEach(t => t.stop());

        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(d => d.kind === 'videoinput');
        console.log('📹 Danh sách camera:', videoDevices);

        if (videoDevices.length === 0) throw new Error('Không tìm thấy camera nào!');

        availableCameras = videoDevices;
        cameraSelect.innerHTML = '';

        if (deviceInfo.isMobile || deviceInfo.isTablet) {
            // Mobile/Tablet/iPad: dùng facingMode
            const backOpt = document.createElement('option');
            backOpt.value = 'environment';
            backOpt.textContent = '📷 Camera Sau (Khuyến nghị)';
            cameraSelect.appendChild(backOpt);

            const frontOpt = document.createElement('option');
            frontOpt.value = 'user';
            frontOpt.textContent = '🤳 Camera Trước';
            cameraSelect.appendChild(frontOpt);

            selectedDeviceId = 'environment';
            cameraSelect.value = 'environment';
        } else {
            // Desktop/Laptop: dùng deviceId, ưu tiên USB/external
            const optionsData = videoDevices.map((device, index) => {
                let label = device.label || `Camera ${index + 1}`;
                let priority = 0;

                const lbl = label.toLowerCase();
                if (lbl.includes('usb') || lbl.includes('external') || lbl.includes('webcam') ||
                    lbl.includes('logitech') || lbl.includes('brio') || lbl.includes('c920') ||
                    lbl.includes('c922') || lbl.includes('elgato') || lbl.includes('obs')) {
                    label = `🎥 ${label} (Khuyến nghị)`;
                    priority = 3;
                } else if (lbl.includes('back') || lbl.includes('rear')) {
                    label = `📷 ${label}`;
                    priority = 2;
                } else if (lbl.includes('front') || lbl.includes('facetime') || lbl.includes('integrated') ||
                           lbl.includes('built-in') || lbl.includes('internal')) {
                    label = `🤳 ${label}`;
                    priority = 1;
                } else {
                    label = `🎥 ${label}`;
                    priority = 1;
                }

                return { deviceId: device.deviceId, label, priority };
            });

            // Sắp xếp theo priority giảm dần
            optionsData.sort((a, b) => b.priority - a.priority);

            optionsData.forEach(item => {
                const opt = document.createElement('option');
                opt.value = item.deviceId;
                opt.textContent = item.label;
                cameraSelect.appendChild(opt);
            });

            selectedDeviceId = optionsData[0].deviceId;
            cameraSelect.value = selectedDeviceId;
            console.log('✅ Desktop: Camera được chọn:', optionsData[0].label);
        }

    } catch (err) {
        console.error('❌ Lỗi khi liệt kê camera:', err);
        cameraSelect.innerHTML = '<option>❌ Lỗi: ' + err.message + '</option>';
        statusElement.textContent = '❌ Lỗi camera: ' + err.message;
        statusElement.style.color = '#f00';
    }
}

// ===== KHỞI ĐỘNG CAMERA (Tối ưu cho 30 học sinh - Mọi thiết bị) =====
async function startCamera(deviceIdOrFacingMode = null) {
    try {
        if (video.srcObject) {
            video.srcObject.getTracks().forEach(t => t.stop());
            video.srcObject = null;
        }

        const deviceInfo = detectDeviceType();
        let constraints;

        // Luôn yêu cầu landscape (width > height) để bao phủ chiều ngang lớp học
        const landscapeVideo = {
            width:  { ideal: 1920, min: 1280 },
            height: { ideal: 1080, min: 720 },
            frameRate: { ideal: 30 }
        };

        if (deviceIdOrFacingMode === 'environment' || deviceIdOrFacingMode === 'user') {
            // Mobile/Tablet/iPad: không dùng exact trên iOS
            constraints = {
                video: {
                    facingMode: deviceInfo.isIOS ? deviceIdOrFacingMode : { exact: deviceIdOrFacingMode },
                    ...landscapeVideo
                }
            };
            console.log('📱 Mobile/Tablet mode:', deviceIdOrFacingMode);
        } else {
            // Desktop/Laptop: deviceId
            constraints = {
                video: {
                    deviceId: deviceIdOrFacingMode ? { exact: deviceIdOrFacingMode } : undefined,
                    ...landscapeVideo,
                    frameRate: { ideal: 30, max: 60 }
                }
            };
            console.log('💻 Desktop mode, deviceId:', deviceIdOrFacingMode);
        }

        let stream;
        try {
            stream = await navigator.mediaDevices.getUserMedia(constraints);
        } catch (constraintErr) {
            // Fallback: thử lại với constraints đơn giản hơn
            console.warn('⚠️ Constraint thất bại, thử fallback:', constraintErr.name);
            const fallback = {
                video: deviceIdOrFacingMode && deviceIdOrFacingMode !== 'environment' && deviceIdOrFacingMode !== 'user'
                    ? { deviceId: { exact: deviceIdOrFacingMode } }
                    : { facingMode: deviceIdOrFacingMode || 'user' }
            };
            stream = await navigator.mediaDevices.getUserMedia(fallback);
        }

        video.srcObject = stream;

        const videoTrack = stream.getVideoTracks()[0];
        const settings = videoTrack.getSettings();
        console.log('📹 Camera settings:', settings);

        return new Promise((resolve) => {
            video.onloadedmetadata = () => {
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                console.log(`✅ Camera: ${video.videoWidth}x${video.videoHeight}`);
                // CSS filter hợp lệ (không dùng sharpen() vì không tồn tại)
                video.style.filter = 'contrast(1.2) brightness(1.08) saturate(1.15)';
                statusElement.textContent = `✅ Camera: ${settings.width || video.videoWidth}x${settings.height || video.videoHeight} @ ${Math.round(settings.frameRate || 30)}fps`;
                statusElement.style.color = '#0f0';
                resolve();
            };
            // Timeout phòng trường hợp onloadedmetadata không kích hoạt
            setTimeout(() => {
                if (video.videoWidth) {
                    canvas.width = video.videoWidth;
                    canvas.height = video.videoHeight;
                }
                resolve();
            }, 3000);
        });

    } catch (err) {
        console.error('❌ Lỗi camera:', err);
        statusElement.textContent = '❌ Không thể truy cập camera! Kiểm tra quyền truy cập.';
        statusElement.style.color = '#f00';
    }
}

// ===== LOAD AI MODELS =====
async function loadModels() {
    try {
        statusElement.textContent = '⚡ Đang tải AI Models...';
        statusElement.className = 'status loading';

        const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.12/model';

        await Promise.all([
            faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
            faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL)
        ]);

        console.log('✅ AI Models đã load!');
        modelsLoaded = true;
        statusElement.textContent = '✅ AI sẵn sàng! (SSD MobileNet v1 - Nhận diện xa & rộng)';
        statusElement.style.color = '#0f0';
        statusElement.style.textShadow = '0 0 10px #0f0';
        startButton.disabled = false;

    } catch (err) {
        console.error('Lỗi load models:', err);
        statusElement.textContent = '❌ Lỗi tải AI models! Kiểm tra kết nối mạng.';
        statusElement.style.color = '#f00';
    }
}

// ===== MỞ RỘNG BOUNDING BOX =====
function expandBoundingBox(box, canvasWidth, canvasHeight) {
    // Mở rộng mỗi bên 60% width, trên 55%, dưới 110% (lấy cả vai + ngực)
    const newX = box.x - box.width * 0.6;
    const newY = box.y - box.height * 0.55;
    const newWidth = box.width * 2.2;
    const newHeight = box.height * 2.65;

    const clampedX = Math.max(0, newX);
    const clampedY = Math.max(0, newY);
    const clampedWidth = Math.min(newWidth, canvasWidth - clampedX);
    const clampedHeight = Math.min(newHeight, canvasHeight - clampedY);

    return { x: clampedX, y: clampedY, width: clampedWidth, height: clampedHeight };
}

// ===== MULTI-SCALE DETECTION: Bắt khuôn mặt nhỏ ở xa =====
// Vẽ video lên canvas tạm với scale khác nhau rồi chạy detection
async function detectAtScale(sourceVideo, scale) {
    const vw = sourceVideo.videoWidth;
    const vh = sourceVideo.videoHeight;

    // Tính vùng nhìn thấy sau khi CSS zoom (crop vào giữa)
    const visibleW = vw / currentZoom;
    const visibleH = vh / currentZoom;
    const offsetX = (vw - visibleW) / 2;
    const offsetY = (vh - visibleH) / 2;

    const w = Math.round(visibleW * scale);
    const h = Math.round(visibleH * scale);

    const offscreen = document.createElement('canvas');
    offscreen.width = w;
    offscreen.height = h;
    const offCtx = offscreen.getContext('2d');

    offCtx.filter = 'contrast(1.3) brightness(1.1)';
    // Chỉ vẽ vùng đang nhìn thấy (sau zoom)
    offCtx.drawImage(sourceVideo, offsetX, offsetY, visibleW, visibleH, 0, 0, w, h);

    const options = new faceapi.SsdMobilenetv1Options({
        minConfidence: 0.25,
        maxResults: 50
    });

    const results = await faceapi.detectAllFaces(offscreen, options);

    // Chuyển tọa độ về không gian video gốc
    return results.map(det => {
        const b = det.box;
        return {
            score: det.score,
            box: {
                x: (b.x / scale) + offsetX,
                y: (b.y / scale) + offsetY,
                width: b.width / scale,
                height: b.height / scale
            }
        };
    });
}

// Loại bỏ các box trùng lặp (IoU > threshold)
function iou(a, b) {
    const x1 = Math.max(a.x, b.x);
    const y1 = Math.max(a.y, b.y);
    const x2 = Math.min(a.x + a.width, b.x + b.width);
    const y2 = Math.min(a.y + a.height, b.y + b.height);
    const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    const union = a.width * a.height + b.width * b.height - inter;
    return union > 0 ? inter / union : 0;
}

function mergeDetections(allResults) {
    // Sắp xếp theo score giảm dần
    const sorted = allResults.slice().sort((a, b) => b.score - a.score);
    const kept = [];
    for (const det of sorted) {
        const overlap = kept.some(k => iou(k.box, det.box) > 0.4);
        if (!overlap) kept.push(det);
    }
    return kept;
}

// ===== PHÁT HIỆN KHUÔN MẶT LIÊN TỤC =====
async function detectFaces() {
    if (!modelsLoaded || !video.videoWidth) {
        animationFrameId = requestAnimationFrame(detectFaces);
        return;
    }

    try {
        // Chạy song song 3 scale:
        // 1.0 = gốc (mặt gần, to)
        // 1.5 = phóng to 1.5x (bắt mặt trung bình)
        // 2.2 = phóng to 2.2x (bắt mặt nhỏ ở xa)
        const [r1, r2, r3] = await Promise.all([
            detectAtScale(video, 1.0),
            detectAtScale(video, 1.5),
            detectAtScale(video, 2.2)
        ]);

        const merged = mergeDetections([...r1, ...r2, ...r3]);
        detections = merged;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        if (!isScanning) {
            detections.forEach((detection, index) => {
                const expandedBox = expandBoundingBox(detection.box, canvas.width, canvas.height);
                ctx.strokeStyle = '#f00';
                ctx.lineWidth = 3;
                ctx.shadowBlur = 15;
                ctx.shadowColor = '#f00';
                ctx.strokeRect(expandedBox.x, expandedBox.y, expandedBox.width, expandedBox.height);
                ctx.fillStyle = '#f00';
                ctx.font = 'bold 14px Courier New';
                ctx.shadowBlur = 0;
                ctx.fillText(`#${index + 1}`, expandedBox.x + 5, expandedBox.y + 20);
            });

            // Hiển thị số lượng khuôn mặt phát hiện được
            if (detections.length > 0) {
                ctx.fillStyle = '#0ff';
                ctx.font = 'bold 16px Courier New';
                ctx.shadowBlur = 8;
                ctx.shadowColor = '#0ff';
                ctx.fillText(`👥 ${detections.length} người`, 10, canvas.height - 10);
                ctx.shadowBlur = 0;
            }
        }

    } catch (err) {
        console.error('Lỗi phát hiện khuôn mặt:', err);
    }

    animationFrameId = requestAnimationFrame(detectFaces);
}

// ===== HIỆU ỨNG CHỌN NGẪU NHIÊN =====
async function startRandomSelection() {
    if (detections.length === 0) {
        alert('⚠️ Không phát hiện khuôn mặt nào! Hãy đảm bảo có người trong khung hình.');
        return;
    }

    isScanning = true;
    startButton.disabled = true;
    scanDurationSlider.disabled = true;
    statusElement.textContent = `🎯 ĐANG QUÉT (${scanDuration / 1000}s)... Phát hiện ${detections.length} khuôn mặt`;
    statusElement.style.color = '#f00';

    playBeep();

    scanTimerHorizontal.style.display = 'block';
    scanTimerFillHorizontal.style.width = '0%';

    const duration = scanDuration;
    const startTime = performance.now();
    let currentTargetIndex = -1;
    let lastBeepTime = startTime;
    const beepInterval = Math.max(200, duration / 10);
    let hopInterval = 80;
    let lastHopTime = startTime;

    function animateScan(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);

        if (currentTime - lastBeepTime > beepInterval && progress < 0.95) {
            playBeep();
            lastBeepTime = currentTime;
        }

        // Speed ramping
        if (progress < 0.7) {
            hopInterval = 80;
        } else if (progress < 0.9) {
            hopInterval = 150;
        } else {
            hopInterval = 300 + (progress - 0.9) * 2000;
        }

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        scanTimerFillHorizontal.style.width = (progress * 100) + '%';

        if (detections.length > 0) {
            // Vẽ tất cả ô đỏ
            detections.forEach((detection) => {
                const expandedBox = expandBoundingBox(detection.box, canvas.width, canvas.height);
                ctx.strokeStyle = '#f00';
                ctx.lineWidth = 3;
                ctx.shadowBlur = 15;
                ctx.shadowColor = '#f00';
                ctx.strokeRect(expandedBox.x, expandedBox.y, expandedBox.width, expandedBox.height);
                ctx.shadowBlur = 0;
            });

            // Random hopping
            if (currentTime - lastHopTime > hopInterval) {
                currentTargetIndex = Math.floor(Math.random() * detections.length);
                lastHopTime = currentTime;
            }

            // Vẽ crosshair
            if (currentTargetIndex >= 0 && currentTargetIndex < detections.length) {
                const expandedTargetBox = expandBoundingBox(detections[currentTargetIndex].box, canvas.width, canvas.height);
                const centerX = expandedTargetBox.x + expandedTargetBox.width / 2;
                const centerY = expandedTargetBox.y + expandedTargetBox.height / 2;
                const size = Math.max(expandedTargetBox.width, expandedTargetBox.height) * 0.8;

                let crosshairColor = '#0ff';
                if (progress > 0.9) crosshairColor = '#ff0';
                else if (progress > 0.7) crosshairColor = '#0f0';

                ctx.strokeStyle = crosshairColor;
                ctx.lineWidth = 4;
                ctx.shadowBlur = 20;
                ctx.shadowColor = crosshairColor;

                ctx.beginPath();
                ctx.moveTo(centerX - size / 2, centerY);
                ctx.lineTo(centerX + size / 2, centerY);
                ctx.moveTo(centerX, centerY - size / 2);
                ctx.lineTo(centerX, centerY + size / 2);
                ctx.stroke();

                ctx.beginPath();
                ctx.arc(centerX, centerY, size / 2, 0, 2 * Math.PI);
                ctx.stroke();
                ctx.shadowBlur = 0;
            }
        }

        if (progress < 1) {
            requestAnimationFrame(animateScan);
        } else {
            scanTimerFillHorizontal.style.width = '100%';
            scanTimerHorizontal.style.display = 'none';
            // Truyền thẳng index đang highlight vào finishSelection, không delay
            finishSelection(currentTargetIndex >= 0 ? currentTargetIndex : Math.floor(Math.random() * detections.length));
        }
    }

    requestAnimationFrame(animateScan);
}

// ===== KẾT THÚC VÀ HIỂN THỊ KẾT QUẢ =====
function finishSelection(finalIndex) {
    playTing();

    if (detections.length === 0) {
        alert('⚠️ Không còn khuôn mặt nào trong khung hình!');
        isScanning = false;
        startButton.disabled = false;
        scanDurationSlider.disabled = false;
        return;
    }

    // Dùng index từ animation, không random lại
    if (finalIndex === undefined || finalIndex < 0 || finalIndex >= detections.length) {
        finalIndex = Math.floor(Math.random() * detections.length);
    }

    const box = detections[finalIndex].box;

    // Crop và hiển thị overlay NGAY LẬP TỨC
    const expandedFinalBox = expandBoundingBox(box, canvas.width, canvas.height);
    resultImageLarge.src = cropFace(expandedFinalBox);
    resultOverlay.style.display = 'flex';

    statusElement.textContent = '✅ ĐÃ CHỌN XONG!';
    statusElement.style.color = '#0f0';
    statusElement.style.textShadow = '0 0 10px #0f0';

    // Blink canvas ở nền (không block overlay)
    let blinkCount = 0;
    const maxBlinks = 4;
    const blinkInterval = setInterval(() => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        detections.forEach((detection, index) => {
            const expandedBox = expandBoundingBox(detection.box, canvas.width, canvas.height);
            if (index === finalIndex) {
                ctx.strokeStyle = blinkCount % 2 === 0 ? '#0f0' : '#ff0';
                ctx.lineWidth = 6;
                ctx.shadowBlur = 30;
                ctx.shadowColor = blinkCount % 2 === 0 ? '#0f0' : '#ff0';
            } else {
                ctx.strokeStyle = '#f00';
                ctx.lineWidth = 3;
                ctx.shadowBlur = 15;
                ctx.shadowColor = '#f00';
            }
            ctx.strokeRect(expandedBox.x, expandedBox.y, expandedBox.width, expandedBox.height);
            ctx.shadowBlur = 0;
        });
        blinkCount++;
        if (blinkCount >= maxBlinks) {
            clearInterval(blinkInterval);
            isScanning = false;
        }
    }, 100);
}

// ===== CROP KHUÔN MẶT =====
function cropFace(expandedBox) {
    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d');

    const zoomFactor = 1.5;
    tempCanvas.width = Math.round(expandedBox.width * zoomFactor);
    tempCanvas.height = Math.round(expandedBox.height * zoomFactor);

    tempCtx.imageSmoothingEnabled = true;
    tempCtx.imageSmoothingQuality = 'high';

    tempCtx.drawImage(
        video,
        expandedBox.x, expandedBox.y, expandedBox.width, expandedBox.height,
        0, 0, tempCanvas.width, tempCanvas.height
    );

    return tempCanvas.toDataURL('image/jpeg', 0.95);
}

// ===== NÚT CHÚC MỪNG =====
btnCelebrate.addEventListener('click', () => {
    alert('🎉 Chúc mừng bạn đã được chọn! 🎉');
});

// ===== NÚT TIẾP TỤC QUÉT =====
btnContinue.addEventListener('click', () => {
    resultOverlay.style.display = 'none';
    startButton.disabled = false;
    scanDurationSlider.disabled = false;
    statusElement.textContent = '✅ AI sẵn sàng! Nhấn nút để bắt đầu.';
    statusElement.style.color = '#0f0';
});

// ===== THAY ĐỔI CAMERA =====
cameraSelect.addEventListener('change', async (e) => {
    selectedDeviceId = e.target.value;
    console.log('🔄 Đang chuyển camera:', selectedDeviceId);
    statusElement.textContent = '🔄 Đang chuyển camera...';
    statusElement.style.color = '#ff0';

    if (animationFrameId) cancelAnimationFrame(animationFrameId);

    await startCamera(selectedDeviceId);
    detectFaces();

    statusElement.textContent = '✅ Đã chuyển camera! Sẵn sàng quét.';
    statusElement.style.color = '#0f0';
});

// ===== SLIDER THỜI GIAN QUÉT =====
scanDurationSlider.addEventListener('input', (e) => {
    const value = parseFloat(e.target.value);
    scanDuration = value * 1000;
    durationValue.textContent = value;
});

// ===== NÚT BẮT ĐẦU QUÉT =====
startButton.addEventListener('click', startRandomSelection);

// ===== LẮNG NGHE XOAY MÀN HÌNH (Mobile/Tablet) =====
screen.orientation
    ? screen.orientation.addEventListener('change', handleOrientationChange)
    : window.addEventListener('orientationchange', handleOrientationChange);

async function handleOrientationChange() {
    if (!selectedDeviceId) return;
    // Đợi browser hoàn tất xoay xong rồi mới restart camera
    setTimeout(async () => {
        console.log('🔄 Xoay màn hình, restart camera...');
        if (animationFrameId) cancelAnimationFrame(animationFrameId);
        await startCamera(selectedDeviceId);
        detectFaces();
    }, 300);
}
navigator.mediaDevices.addEventListener('devicechange', async () => {
    console.log('🔌 Thiết bị thay đổi, cập nhật danh sách camera...');
    const prevSelected = selectedDeviceId;
    await listCameras();
    // Nếu camera cũ vẫn còn, giữ nguyên lựa chọn
    const stillExists = Array.from(cameraSelect.options).some(o => o.value === prevSelected);
    if (stillExists) {
        selectedDeviceId = prevSelected;
        cameraSelect.value = prevSelected;
    }
});

// ===== KHỞI ĐỘNG ỨNG DỤNG =====
async function init() {
    statusElement.textContent = '⚡ Đang khởi động...';
    await listCameras();
    await startCamera(selectedDeviceId);
    await loadModels();
    detectFaces();
}

window.addEventListener('load', init);
