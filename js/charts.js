let rssiChart, snrChart, pdrChart, lossChart;

function smoothArray(arr, windowSize = 5) {
  if (arr.length < windowSize) return arr.slice();
  const half = Math.floor(windowSize / 2);
  return arr.map((_, index) => {
    let sum = 0;
    let count = 0;
    for (let i = index - half; i <= index + half; i++) {
      if (i >= 0 && i < arr.length && Number.isFinite(arr[i])) {
        sum += arr[i];
        count++;
      }
    }
    return count ? sum / count : arr[index];
  });
}

function hexToRgba(hex, alpha) {
  const h = hex.replace("#", "");
  const value = parseInt(h.length === 3 ? h.split("").map(x => x + x).join("") : h, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function createSingleChart(canvasId, label, labels, values, title, yTitle, color, beginAtZero = false, suggestedMin, suggestedMax) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;

  const ctx = canvas.getContext("2d");
  const gradient = ctx.createLinearGradient(0, 0, 0, 290);
  gradient.addColorStop(0, hexToRgba(color, 0.22));
  gradient.addColorStop(1, hexToRgba(color, 0.01));

  return new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label,
        data: values,
        borderColor: color,
        backgroundColor: gradient,
        borderWidth: 2.4,
        pointRadius: values.length > 80 ? 0 : 2.4,
        pointBackgroundColor: "#ffffff",
        pointBorderColor: color,
        pointBorderWidth: 1.8,
        pointHoverRadius: 5,
        pointHoverBackgroundColor: color,
        pointHoverBorderColor: "#ffffff",
        pointHoverBorderWidth: 2,
        tension: 0.28,
        fill: true,
        spanGaps: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: "index" },
      animation: { duration: 550 },
      plugins: {
        title: {
          display: true,
          text: title,
          align: "start",
          color: "#183b4d",
          padding: { top: 2, bottom: 18 },
          font: { family: "Be Vietnam Pro", size: 14, weight: "700" }
        },
        legend: { display: false },
        tooltip: {
          backgroundColor: "rgba(17, 41, 58, .94)",
          titleFont: { family: "Be Vietnam Pro", weight: "700" },
          bodyFont: { family: "JetBrains Mono" },
          padding: 11,
          cornerRadius: 10,
          displayColors: false
        }
      },
      scales: {
        x: {
          grid: { display: false },
          border: { display: false },
          ticks: {
            color: "#718694",
            maxTicksLimit: 8,
            maxRotation: 0,
            minRotation: 0,
            font: { family: "Be Vietnam Pro", size: 10 }
          }
        },
        y: {
          beginAtZero,
          suggestedMin,
          suggestedMax,
          grid: { color: "rgba(30, 83, 104, .08)", drawBorder: false },
          border: { display: false },
          ticks: { color: "#718694", font: { family: "JetBrains Mono", size: 10 } },
          title: {
            display: true,
            text: yTitle,
            color: "#718694",
            font: { family: "Be Vietnam Pro", size: 10, weight: "600" }
          }
        }
      }
    }
  });
}

function renderCharts(labels, rssi, snr, pdr, loss) {
  [rssiChart, snrChart, pdrChart, lossChart].forEach(chart => chart && chart.destroy());
  rssiChart = createSingleChart("rssiChart", "RSSI", labels, rssi, "RSSI theo thời gian", "dBm", "#526b91", false, -130, -20);
  snrChart = createSingleChart("snrChart", "SNR", labels, snr, "SNR theo thời gian", "dB", "#178d91", false, -20, 20);
  pdrChart = createSingleChart("pdrChart", "PDR", labels, pdr, "PDR theo thời gian", "%", "#3d8e65", true, 0, 100);
  lossChart = createSingleChart("lossChart", "Packet Loss", labels, loss, "Packet Loss theo thời gian", "%", "#c66d5b", true, 0, 100);
}
