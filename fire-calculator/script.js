'use strict';

let fireChart = null;

// ═══════════════════ INIT ═══════════════════
document.addEventListener('DOMContentLoaded', () => {
    bindSliders();
    bindMoneyInputs();
    calculate();
});

// ═══════════════════ BIND CONTROLS ═══════════════════
function bindSliders() {
    const sliders = [
        { id: 'currentAge',      label: (v) => v + ' yrs' },
        { id: 'lifeExpectancy',  label: (v) => v + ' yrs' },
        { id: 'preReturn',       label: (v) => parseFloat(v).toFixed(1) + '%' },
        { id: 'postReturn',      label: (v) => parseFloat(v).toFixed(1) + '%' },
        { id: 'inflation',       label: (v) => parseFloat(v).toFixed(1) + '%' },
        { id: 'withdrawal',      label: (v) => parseFloat(v).toFixed(1) + '%' },
    ];

    sliders.forEach(({ id, label }) => {
        const el = document.getElementById(id);
        const valEl = document.getElementById('val-' + id);
        if (!el || !valEl) return;
        el.addEventListener('input', () => {
            valEl.textContent = label(el.value);
            if (id === 'withdrawal') updateWithdrawalNote(parseFloat(el.value));
            calculate();
        });
    });
}

function bindMoneyInputs() {
    ['annualExpenses', 'currentCorpus', 'monthlyInvestment'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('input', () => {
            updateMoneyUnit(id, +el.value);
            calculate();
        });
        updateMoneyUnit(id, +el.value);
    });
}

function updateMoneyUnit(id, val) {
    const units = {
        annualExpenses: 'unit-expenses',
        currentCorpus:  'unit-corpus',
        monthlyInvestment: 'unit-sip',
    };
    const suffixes = {
        annualExpenses: ' / yr',
        currentCorpus:  '',
        monthlyInvestment: ' / mo',
    };
    const el = document.getElementById(units[id]);
    if (el) el.textContent = formatUnit(val) + suffixes[id];
}

function updateWithdrawalNote(rate) {
    const el = document.getElementById('withdrawal-note');
    if (!el) return;
    const multiple = Math.round(100 / rate);
    let label = 'Classic safe withdrawal rate.';
    if (rate <= 2.5)   label = 'Ultra-conservative — very large corpus needed, maximum safety.';
    else if (rate <= 3.5) label = 'Conservative — strong long-term sustainability.';
    else if (rate <= 4.5) label = 'Classic safe withdrawal rate.';
    else if (rate <= 6)   label = 'Moderate risk — suits shorter retirements.';
    else                  label = 'Aggressive — high risk of corpus depletion in long retirements.';
    el.innerHTML = `At ${rate.toFixed(1)}% — you need <strong>${multiple}×</strong> your annual retirement expenses. ${label}`;
}

// ═══════════════════ CORE CALCULATION ═══════════════════
function getInputs() {
    return {
        currentAge:        +document.getElementById('currentAge').value,
        lifeExpectancy:    +document.getElementById('lifeExpectancy').value,
        annualExpenses:    +document.getElementById('annualExpenses').value || 0,
        currentCorpus:     +document.getElementById('currentCorpus').value || 0,
        monthlyInvestment: +document.getElementById('monthlyInvestment').value || 0,
        preReturn:         +document.getElementById('preReturn').value / 100,
        postReturn:        +document.getElementById('postReturn').value / 100,
        inflation:         +document.getElementById('inflation').value / 100,
        withdrawal:        +document.getElementById('withdrawal').value / 100,
    };
}

function runFIRE(p) {
    const monthlyPreRate = p.preReturn / 12;
    const maxYears = p.lifeExpectancy - p.currentAge + 20;

    // ── ACCUMULATION PHASE ──
    // Required corpus grows with inflation because future expenses are higher.
    // We find the FIRE age where corpus ≥ inflation-adjusted required corpus.
    let corpus = p.currentCorpus;
    let fireAge = null;
    let requiredAtFire = null;
    let corpusAtFire = null;
    const accData = [{ age: p.currentAge, value: corpus }];

    for (let yr = 1; yr <= maxYears; yr++) {
        const age = p.currentAge + yr;

        // Corpus grows with pre-retirement return (monthly compounding) + monthly SIP
        if (monthlyPreRate > 0) {
            const growFactor = Math.pow(1 + monthlyPreRate, 12);
            corpus = corpus * growFactor + p.monthlyInvestment * (growFactor - 1) / monthlyPreRate;
        } else {
            corpus = corpus + p.monthlyInvestment * 12;
        }

        accData.push({ age, value: corpus });

        // Inflation-adjusted required corpus at this age
        const futureExpenses = p.annualExpenses * Math.pow(1 + p.inflation, yr);
        const reqNow = futureExpenses / p.withdrawal;

        if (!fireAge && corpus >= reqNow) {
            fireAge = age;
            requiredAtFire = reqNow;
            corpusAtFire = corpus;
        }

        if (fireAge && age >= p.lifeExpectancy) break;
    }

    if (!fireAge) {
        // Never reaches FIRE — show how much is needed at life expectancy
        const expAtLE = p.annualExpenses * Math.pow(1 + p.inflation, p.lifeExpectancy - p.currentAge);
        const reqAtLE = expAtLE / p.withdrawal;
        return {
            reachable: false,
            fireAge: null,
            requiredAtFire: reqAtLE,
            corpusAtFire: null,
            accData: accData.filter(d => d.age <= p.lifeExpectancy),
            retData: [],
            sustainable: false,
            depletionAge: null,
            finalCorpus: corpus,
            yearsInRetirement: 0,
        };
    }

    // ── RETIREMENT PHASE ──
    // Annual withdrawal starts at (annualExpenses × inflation^yearsToFire) and
    // grows with inflation each subsequent retirement year.
    const yearsToFire = fireAge - p.currentAge;
    const initialWithdrawal = p.annualExpenses * Math.pow(1 + p.inflation, yearsToFire);
    let retCorpus = corpusAtFire;
    const retData = [{ age: fireAge, value: retCorpus }];
    let depletionAge = null;

    for (let yr = 1; yr <= (p.lifeExpectancy - fireAge); yr++) {
        const age = fireAge + yr;
        const withdrawal = initialWithdrawal * Math.pow(1 + p.inflation, yr);
        retCorpus = retCorpus * (1 + p.postReturn) - withdrawal;

        if (retCorpus <= 0 && !depletionAge) {
            depletionAge = age;
            retData.push({ age, value: 0 });
            break;
        }
        retData.push({ age, value: retCorpus });
    }

    const finalCorpus = retData[retData.length - 1].value;
    const sustainable = !depletionAge;
    const yearsInRetirement = p.lifeExpectancy - fireAge;

    return {
        reachable: true,
        fireAge,
        requiredAtFire,
        corpusAtFire,
        accData: accData.filter(d => d.age <= fireAge),
        retData,
        sustainable,
        depletionAge,
        finalCorpus,
        yearsInRetirement,
        yearsToFire,
    };
}

// Find minimum withdrawal rate that is sustainable for the full retirement
function findSafeRate(p) {
    let lo = 2, hi = +document.getElementById('withdrawal').value;
    for (let i = 0; i < 20; i++) {
        const mid = (lo + hi) / 2;
        const res = runFIRE({ ...p, withdrawal: mid / 100 });
        if (res.reachable && res.sustainable) hi = mid;
        else lo = mid;
    }
    return hi.toFixed(1);
}

// ═══════════════════ UPDATE DOM ═══════════════════
function calculate() {
    const p = getInputs();
    if (!p.annualExpenses) return;

    const result = runFIRE(p);
    updateMetrics(result, p);
    updateChart(result, p);
    updateInsight(result, p);
}

function updateMetrics(r, p) {
    // FIRE Age
    const fireAgeEl = document.getElementById('res-fireAge');
    const yearsToFireEl = document.getElementById('res-yearsToFire');
    if (r.fireAge) {
        fireAgeEl.textContent = r.fireAge;
        yearsToFireEl.textContent = r.yearsToFire + ' years from now';
    } else {
        fireAgeEl.textContent = '—';
        yearsToFireEl.textContent = 'Not reachable in lifetime';
    }

    // Required Corpus
    document.getElementById('res-requiredCorpus').textContent =
        r.requiredAtFire ? formatCr(r.requiredAtFire) : '—';

    // Years in Retirement
    document.getElementById('res-yearsRetirement').textContent =
        r.yearsInRetirement > 0 ? r.yearsInRetirement + ' yrs' : '—';
    document.getElementById('res-lifeNote').textContent = 'up to age ' + p.lifeExpectancy;

    // Sustainability
    const card = document.getElementById('sustainCard');
    const sustainEl = document.getElementById('res-sustainability');
    const finalEl = document.getElementById('res-finalCorpus');
    card.className = 'fi-metric';

    if (!r.reachable) {
        sustainEl.textContent = 'N/A';
        finalEl.textContent = 'Increase savings or adjust withdrawal';
    } else if (r.sustainable) {
        card.classList.add('sustain-safe');
        sustainEl.textContent = 'Safe';
        finalEl.textContent = 'Surplus: ' + formatCr(r.finalCorpus) + ' at age ' + p.lifeExpectancy;
    } else if (r.depletionAge && (p.lifeExpectancy - r.depletionAge) <= 5) {
        card.classList.add('sustain-warn');
        sustainEl.textContent = 'Borderline';
        finalEl.textContent = 'Depletes at age ' + r.depletionAge;
    } else {
        card.classList.add('sustain-danger');
        sustainEl.textContent = 'Runs Out';
        finalEl.textContent = 'Depletes at age ' + r.depletionAge;
    }
}

function updateInsight(r, p) {
    const textEl = document.getElementById('insight-text');
    const iconEl = document.getElementById('insight-icon');

    if (!r.reachable) {
        iconEl.style.color = 'var(--danger)';
        textEl.innerHTML = `<strong>FIRE goal not reachable</strong> with current inputs within your lifetime. ` +
            `Consider increasing your monthly investment or reducing planned expenses.`;
        return;
    }

    const wPct = (p.withdrawal * 100).toFixed(1);
    const multiple = Math.round(1 / p.withdrawal);

    if (r.sustainable) {
        const safeRate = findSafeRate(p);
        iconEl.style.color = 'var(--success)';
        textEl.innerHTML =
            `<strong>You can retire at ${r.fireAge}</strong> with ${formatCr(r.corpusAtFire)} corpus. ` +
            `At ${wPct}% withdrawal (${multiple}× expenses), your corpus lasts all ` +
            `<strong>${r.yearsInRetirement} years</strong> of retirement with ` +
            `<strong>${formatCr(r.finalCorpus)}</strong> remaining at age ${p.lifeExpectancy}. ` +
            (parseFloat(safeRate) < parseFloat(wPct)
                ? `The minimum safe withdrawal rate for this scenario is ${safeRate}%.`
                : '');
    } else {
        iconEl.style.color = 'var(--warning)';
        const safeRate = findSafeRate(p);
        textEl.innerHTML =
            `<strong>Corpus depletes at age ${r.depletionAge}</strong> — ${p.lifeExpectancy - r.depletionAge} years ` +
            `before your life expectancy of ${p.lifeExpectancy}. ` +
            `This is because ${r.yearsInRetirement} years of retirement is long, and at ${wPct}% withdrawal the ` +
            `portfolio cannot sustain inflation-adjusted expenses. ` +
            `<strong>Reduce withdrawal to ${safeRate}%</strong> to cover the full retirement period.`;
    }
}

// ═══════════════════ CHART ═══════════════════
function updateChart(result, p) {
    const ctx = document.getElementById('fireChart').getContext('2d');

    if (fireChart) { fireChart.destroy(); fireChart = null; }

    // Build full age axis
    const ages = [];
    for (let age = p.currentAge; age <= p.lifeExpectancy; age++) ages.push(age);

    // Accumulation dataset
    const accValues = ages.map(age => {
        const d = result.accData.find(x => x.age === age);
        return d !== undefined ? +(d.value / 1e7).toFixed(3) : null;
    });

    // Retirement dataset
    const retValues = ages.map(age => {
        const d = result.retData.find(x => x.age === age);
        if (d === undefined) return null;
        return +(Math.max(0, d.value) / 1e7).toFixed(3);
    });

    // Required corpus reference line (shown during accumulation only)
    const reqValues = ages.map(age => {
        if (!result.reachable || !result.requiredAtFire) return null;
        // Only show up to FIRE age
        if (result.fireAge && age > result.fireAge) return null;
        return +(result.requiredAtFire / 1e7).toFixed(3);
    });

    const retColor = result.sustainable ? '#16A34A' : '#D97706';
    const retBg    = result.sustainable ? 'rgba(22,163,74,0.06)' : 'rgba(217,119,6,0.06)';
    const fireAge  = result.fireAge;

    fireChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: ages,
            datasets: [
                {
                    label: 'Accumulation',
                    data: accValues,
                    borderColor: '#2563EB',
                    backgroundColor: 'rgba(37,99,235,0.06)',
                    borderWidth: 2.5,
                    fill: true,
                    tension: 0.4,
                    pointRadius: 0,
                    pointHoverRadius: 5,
                    pointHoverBackgroundColor: '#2563EB',
                },
                {
                    label: 'Retirement',
                    data: retValues,
                    borderColor: retColor,
                    backgroundColor: retBg,
                    borderWidth: 2.5,
                    fill: true,
                    tension: 0.4,
                    pointRadius: 0,
                    pointHoverRadius: 5,
                    pointHoverBackgroundColor: retColor,
                },
                {
                    label: 'Target Corpus',
                    data: reqValues,
                    borderColor: 'rgba(0,0,0,0.18)',
                    borderWidth: 1.5,
                    borderDash: [6, 4],
                    pointRadius: 0,
                    fill: false,
                    tension: 0,
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            animation: { duration: 350 },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(28,28,28,0.92)',
                    titleColor: '#fff',
                    bodyColor: 'rgba(255,255,255,.75)',
                    padding: 12,
                    callbacks: {
                        title: (items) => 'Age ' + items[0].label,
                        label: (item) => {
                            if (item.raw === null) return null;
                            return ` ${item.dataset.label}: ₹${item.raw.toFixed(2)} Cr`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    title: { display: true, text: 'Age', color: '#9B9B9B', font: { size: 11 } },
                    grid: { color: 'rgba(0,0,0,0.04)' },
                    ticks: { color: '#9B9B9B', font: { size: 11 }, maxTicksLimit: 10 }
                },
                y: {
                    title: { display: true, text: 'Corpus (₹ Crore)', color: '#9B9B9B', font: { size: 11 } },
                    min: 0,
                    grid: { color: 'rgba(0,0,0,0.04)' },
                    ticks: {
                        color: '#9B9B9B',
                        font: { size: 11 },
                        callback: (v) => '₹' + v.toFixed(1) + ' Cr'
                    }
                }
            }
        },
        plugins: [fireAgeLine(fireAge, ages)]
    });
}

// Custom plugin: vertical dashed line at FIRE age
function fireAgeLine(fireAge, ages) {
    return {
        id: 'fireAgeLine',
        afterDraw(chart) {
            if (!fireAge) return;
            const idx = ages.indexOf(fireAge);
            if (idx < 0) return;
            const { ctx, chartArea, scales } = chart;
            const x = scales.x.getPixelForValue(fireAge);
            ctx.save();
            ctx.beginPath();
            ctx.setLineDash([5, 4]);
            ctx.strokeStyle = 'rgba(255,80,0,0.6)';
            ctx.lineWidth = 1.5;
            ctx.moveTo(x, chartArea.top);
            ctx.lineTo(x, chartArea.bottom);
            ctx.stroke();
            ctx.setLineDash([]);
            // Label
            ctx.fillStyle = 'var(--primary, #FF5000)';
            ctx.font = 'bold 10px Lato, sans-serif';
            const label = 'FIRE ' + fireAge;
            const tw = ctx.measureText(label).width;
            const labelX = (x + tw + 8 > chartArea.right) ? x - tw - 6 : x + 4;
            ctx.fillText(label, labelX, chartArea.top + 14);
            ctx.restore();
        }
    };
}

// ═══════════════════ FORMATTERS ═══════════════════
function formatCr(n) {
    if (!n && n !== 0) return '—';
    if (n >= 1e7) return '₹' + (n / 1e7).toFixed(2) + ' Cr';
    if (n >= 1e5) return '₹' + (n / 1e5).toFixed(1) + ' L';
    return '₹' + Math.round(n).toLocaleString('en-IN');
}

function formatUnit(n) {
    if (!n) return '';
    if (n >= 1e7) return (n / 1e7).toFixed(2) + ' Cr';
    if (n >= 1e5) return (n / 1e5).toFixed(1) + ' L';
    if (n >= 1e3) return (n / 1e3).toFixed(0) + ' K';
    return '';
}
