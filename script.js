const page1 = document.getElementById("page1");
const page2 = document.getElementById("page2");

const drawCanvas = document.getElementById("drawCanvas");
const drawCtx = drawCanvas.getContext("2d");

const outputCanvas = document.getElementById("outputCanvas");
const outputCtx = outputCanvas.getContext("2d");

const doneBtn = document.getElementById("doneBtn");
const clearBtn = document.getElementById("clearBtn");
const backBtn = document.getElementById("backBtn");
const colorButtons = document.querySelectorAll(".color-btn");

let drawing = false;
let currentColor = "#ff2b2b";

let animationId = null;
let croppedShapeCanvas = null;

let tunnelLayers = [];
let zoomPhase = 0;

// --------------------
// setup
// --------------------
drawCtx.lineCap = "round";
drawCtx.lineJoin = "round";
drawCtx.lineWidth = 4;
drawCtx.strokeStyle = currentColor;

function showPage(pageNumber) {
  page1.classList.remove("active");
  page2.classList.remove("active");

  if (pageNumber === 1) {
    page1.classList.add("active");
  } else {
    page2.classList.add("active");
  }
}

function resizeOutputCanvas() {
  outputCanvas.width = window.innerWidth;
  outputCanvas.height = window.innerHeight;
}

resizeOutputCanvas();
window.addEventListener("resize", resizeOutputCanvas);

// --------------------
// drawing
// --------------------
function getMousePos(canvas, event) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;

  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY
  };
}

function startDraw(event) {
  drawing = true;
  const pos = getMousePos(drawCanvas, event);
  drawCtx.beginPath();
  drawCtx.moveTo(pos.x, pos.y);
}

function draw(event) {
  if (!drawing) return;

  const pos = getMousePos(drawCanvas, event);
  drawCtx.lineTo(pos.x, pos.y);
  drawCtx.stroke();
}

function endDraw() {
  if (!drawing) return;
  drawing = false;
  drawCtx.closePath();
}

drawCanvas.addEventListener("mousedown", startDraw);
drawCanvas.addEventListener("mousemove", draw);
window.addEventListener("mouseup", endDraw);

drawCanvas.addEventListener(
  "touchstart",
  (event) => {
    event.preventDefault();
    const touch = event.touches[0];
    startDraw(touch);
  },
  { passive: false }
);

drawCanvas.addEventListener(
  "touchmove",
  (event) => {
    event.preventDefault();
    const touch = event.touches[0];
    draw(touch);
  },
  { passive: false }
);

drawCanvas.addEventListener(
  "touchend",
  (event) => {
    event.preventDefault();
    endDraw();
  },
  { passive: false }
);

// --------------------
// color
// --------------------
colorButtons.forEach((button) => {
  button.addEventListener("click", () => {
    colorButtons.forEach((btn) => btn.classList.remove("active"));
    button.classList.add("active");
    currentColor = button.dataset.color;
    drawCtx.strokeStyle = currentColor;
  });
});

// --------------------
// clear
// --------------------
clearBtn.addEventListener("click", () => {
  drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
});

// --------------------
// crop drawing
// --------------------
function getNonTransparentBounds(ctx, w, h) {
  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;

  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const a = data[i + 3];

      if (a > 0) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX === -1 || maxY === -1) return null;

  return { minX, minY, maxX, maxY };
}

function cropDrawing() {
  const bounds = getNonTransparentBounds(
    drawCtx,
    drawCanvas.width,
    drawCanvas.height
  );

  if (!bounds) return null;

  const padding = 16;

  const sx = Math.max(0, bounds.minX - padding);
  const sy = Math.max(0, bounds.minY - padding);
  const sw = Math.min(
    drawCanvas.width - sx,
    bounds.maxX - bounds.minX + padding * 2
  );
  const sh = Math.min(
    drawCanvas.height - sy,
    bounds.maxY - bounds.minY + padding * 2
  );

  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = sw;
  tempCanvas.height = sh;

  const tempCtx = tempCanvas.getContext("2d");
  tempCtx.clearRect(0, 0, sw, sh);
  tempCtx.drawImage(drawCanvas, sx, sy, sw, sh, 0, 0, sw, sh);

  return tempCanvas;
}

// --------------------
// concentric tunnel
// --------------------
function buildTunnelLayers() {
  tunnelLayers = [];

  // 바깥에서 안쪽까지 레이어 개수
  const layerCount = 20;

  for (let i = 0; i < layerCount; i++) {
    tunnelLayers.push({
      offset: i / layerCount
    });
  }
}

function drawTunnelFrame() {
  outputCtx.clearRect(0, 0, outputCanvas.width, outputCanvas.height);
  outputCtx.fillStyle = "#ffffff";
  outputCtx.fillRect(0, 0, outputCanvas.width, outputCanvas.height);

  if (!croppedShapeCanvas) return;

  const cx = outputCanvas.width / 2;
  const cy = outputCanvas.height / 2;
  const minScreen = Math.min(outputCanvas.width, outputCanvas.height);

  // 제일 큰 바깥 shape가 화면 밖까지 넘어가도록 크게 시작
  const maxSize = minScreen * 2.2;

  // 비율이 일정한 tunnel
  const scaleStep = 0.75;

  // 작은 것부터 큰 것 순서 말고, 큰 것부터 그리기
  // 바깥 레이어가 뒤에 깔리고 안쪽이 위로 올라오도록
    const sorted = [...tunnelLayers].sort((a, b) => {
    const za = (a.offset + zoomPhase) % 1;
    const zb = (b.offset + zoomPhase) % 1;
    return za - zb;
  });

  for (let i = 0; i < sorted.length; i++) {
    const layer = sorted[i];
    const z = (layer.offset + zoomPhase) % 1;

    // z값을 layer index처럼 사용
    const depthIndex = z * tunnelLayers.length;

    // 일정 비율로 작아지는 구조
    const size = maxSize * Math.pow(scaleStep, depthIndex);

    // 너무 작은 건 굳이 안 그림
    if (size < 6) continue;

    // 중심 고정
    const x = cx;
    const y = cy;

    // 회전 거의 없음
    const rotation = 0;

    // 안쪽일수록 또렷하게, 바깥도 완전 사라지진 않게
    const alpha = Math.max(0.12, 1 - depthIndex / tunnelLayers.length);

    outputCtx.save();
    outputCtx.globalAlpha = alpha;
    outputCtx.translate(x, y);
    outputCtx.rotate(rotation);

    outputCtx.drawImage(
      croppedShapeCanvas,
      -size / 2,
      -size / 2,
      size,
      size
    );

    outputCtx.restore();
  }
}

function animateTunnel() {
  drawTunnelFrame();

  // phase가 조금씩 이동하면서 끝없는 zoom-in처럼 보임
  zoomPhase += 0.0010;
  if (zoomPhase >= 1) {
    zoomPhase -= 1;
  }

  animationId = requestAnimationFrame(animateTunnel);
}

// --------------------
// buttons
// --------------------
doneBtn.addEventListener("click", () => {
  const cropped = cropDrawing();
  if (!cropped) return;

  croppedShapeCanvas = cropped;
  resizeOutputCanvas();
  buildTunnelLayers();

  zoomPhase = 0;
  showPage(2);

  if (animationId) {
    cancelAnimationFrame(animationId);
  }

  animationId = requestAnimationFrame(animateTunnel);
});

backBtn.addEventListener("click", () => {
  showPage(1);

  if (animationId) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }

  outputCtx.clearRect(0, 0, outputCanvas.width, outputCanvas.height);
  outputCtx.fillStyle = "#ffffff";
  outputCtx.fillRect(0, 0, outputCanvas.width, outputCanvas.height);
});