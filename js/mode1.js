(function () {
    const data = window.ComissionPayData;
    const metrics = data.metrics;
    const metricMap = metrics.reduce(function (accumulator, metric) {
        accumulator[metric.key] = metric;
        return accumulator;
    }, {});

    const state = {
        amount: 1200,
        currency: 'USD',
        monthlyVolume: 120,
        weights: Object.assign({}, data.defaultMode1Weights),
        selectedPlatformIds: data.platformPresets.map(function (platform) { return platform.id; }),
        customPlatforms: [],
        customError: ''
    };

    let nodes = {};
    let listenersBound = false;

    function clampNumber(value, min, max, fallback) {
        const numericValue = Number(value);
        if (!Number.isFinite(numericValue)) {
            return fallback;
        }
        return Math.min(max, Math.max(min, numericValue));
    }

    function safeAmount(value) {
        return clampNumber(value, 0, 1000000000, 0);
    }

    function safeMonthlyVolume(value) {
        return clampNumber(value, 1, 10000000, 1);
    }

    function formatMoney(value) {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: state.currency,
            maximumFractionDigits: 2
        }).format(Number.isFinite(value) ? value : 0);
    }

    function formatValue(metricKey, value) {
        if (metricKey === 'processingDays') {
            return value.toFixed(0) + 'd';
        }
        if (metricKey === 'effectiveRate' || metricKey === 'commissionPercent' || metricKey === 'withdrawalPercent') {
            return value.toFixed(2) + '%';
        }
        if (metricKey === 'payoutSpeed') {
            return value.toFixed(1);
        }
        return formatMoney(value);
    }

    function getAllPlatforms() {
        return data.platformPresets.concat(state.customPlatforms);
    }

    function getSelectedPlatforms() {
        return getAllPlatforms().filter(function (platform) {
            return state.selectedPlatformIds.indexOf(platform.id) >= 0;
        });
    }

    function computePlatformMetrics(platform) {
        const amount = safeAmount(state.amount);
        const monthlyVolume = safeMonthlyVolume(state.monthlyVolume);
        const commissionCost = amount * (platform.commissionPercent / 100);
        const fixedFee = platform.fixedFee;
        const allocatedMonthlyFee = platform.monthlyFee / monthlyVolume;
        const withdrawalPercentCost = amount * (platform.withdrawalPercent / 100);
        const withdrawalFixed = platform.withdrawalFixed;
        const totalCost = commissionCost + fixedFee + allocatedMonthlyFee + withdrawalPercentCost + withdrawalFixed;
        const netAmount = Math.max(amount - totalCost, 0);
        const effectiveRate = amount > 0 ? (netAmount / amount) * 100 : 0;
        const payoutSpeed = 100 / (platform.processingDays + 1);

        return {
            platform: platform,
            breakdown: {
                commissionCost: commissionCost,
                fixedFee: fixedFee,
                allocatedMonthlyFee: allocatedMonthlyFee,
                withdrawalPercentCost: withdrawalPercentCost,
                withdrawalFixed: withdrawalFixed
            },
            values: {
                commissionPercent: platform.commissionPercent,
                fixedFee: platform.fixedFee,
                monthlyFee: platform.monthlyFee,
                withdrawalPercent: platform.withdrawalPercent,
                withdrawalFixed: platform.withdrawalFixed,
                processingDays: platform.processingDays,
                allocatedMonthlyFee: allocatedMonthlyFee,
                totalCost: totalCost,
                netAmount: netAmount,
                effectiveRate: effectiveRate,
                payoutSpeed: payoutSpeed
            }
        };
    }

    function normalizeResults(results) {
        if (!results.length) {
            return [];
        }

        const ranges = metrics.reduce(function (accumulator, metric) {
            const values = results.map(function (result) { return result.values[metric.key]; });
            accumulator[metric.key] = {
                min: Math.min.apply(Math, values),
                max: Math.max.apply(Math, values)
            };
            return accumulator;
        }, {});

        return results.map(function (result) {
            const normalized = {};
            let weightedTotal = 0;
            let totalWeight = 0;

            metrics.forEach(function (metric) {
                const range = ranges[metric.key];
                const raw = result.values[metric.key];
                let score = 100;

                if (range.max !== range.min) {
                    if (metric.preference === 'low') {
                        score = ((range.max - raw) / (range.max - range.min)) * 100;
                    } else {
                        score = ((raw - range.min) / (range.max - range.min)) * 100;
                    }
                }

                normalized[metric.key] = score;
                const weight = state.weights[metric.key] || 0;
                totalWeight += weight;
                weightedTotal += score * weight;
            });

            result.normalized = normalized;
            result.score = totalWeight > 0 ? weightedTotal / totalWeight : 0;
            return result;
        }).sort(function (left, right) {
            return right.score - left.score;
        });
    }

    function getValidationMessage() {
        if (safeAmount(state.amount) <= 0) {
            return 'Set a transaction amount greater than zero to calculate platform costs.';
        }
        return '';
    }

    function renderConfig() {
        nodes.config.innerHTML = '' +
            '<div class="card__header">' +
                '<div>' +
                    '<p class="eyebrow">Shared assumptions</p>' +
                    '<h3>Scenario controls</h3>' +
                '</div>' +
                '<span class="badge">Live</span>' +
            '</div>' +
            '<div class="grid-fields">' +
                '<div class="field">' +
                    '<label for="mode1-amount">Transaction amount</label>' +
                    '<input class="input" id="mode1-amount" type="number" min="0" step="0.01" data-field="amount" value="' + state.amount + '">' +
                '</div>' +
                '<div class="field">' +
                    '<label for="mode1-currency">Currency</label>' +
                    '<select class="select" id="mode1-currency" data-field="currency">' +
                        '<option value="USD"' + (state.currency === 'USD' ? ' selected' : '') + '>USD</option>' +
                        '<option value="EUR"' + (state.currency === 'EUR' ? ' selected' : '') + '>EUR</option>' +
                        '<option value="GBP"' + (state.currency === 'GBP' ? ' selected' : '') + '>GBP</option>' +
                    '</select>' +
                '</div>' +
                '<div class="field">' +
                    '<label for="mode1-volume">Monthly volume</label>' +
                    '<input class="input" id="mode1-volume" type="number" min="1" step="1" data-field="monthlyVolume" value="' + state.monthlyVolume + '">' +
                '</div>' +
            '</div>' +
            '<p class="help-text">Monthly volume distributes subscription costs so the score stays realistic as scale changes.</p>' +
            (getValidationMessage() ? '<div class="validation-banner">' + getValidationMessage() + '</div>' : '');
    }

    function renderWeights() {
        nodes.weights.innerHTML = '' +
            '<div class="card__header">' +
                '<div>' +
                    '<p class="eyebrow">Weight model</p>' +
                    '<h3>Priority sliders</h3>' +
                '</div>' +
                '<span class="badge badge--success">11 metrics</span>' +
            '</div>' +
            '<div class="slider-group">' +
                metrics.map(function (metric) {
                    return '' +
                        '<label class="slider-row" for="mode1-weight-' + metric.key + '">' +
                            '<div>' +
                                '<strong>' + metric.label + '</strong>' +
                                '<small>' + metric.description + '</small>' +
                            '</div>' +
                            '<input class="slider" id="mode1-weight-' + metric.key + '" type="range" min="0" max="10" step="1" data-weight-key="' + metric.key + '" value="' + state.weights[metric.key] + '">' +
                            '<span class="slider-badge" data-weight-display="' + metric.key + '">' + state.weights[metric.key] + '</span>' +
                        '</label>';
                }).join('') +
            '</div>';
    }

    function renderPlatforms() {
        nodes.platforms.innerHTML = '' +
            '<div class="card__header">' +
                '<div>' +
                    '<p class="eyebrow">Platform universe</p>' +
                    '<h3>Compare providers</h3>' +
                '</div>' +
                '<span class="badge badge--warning">' + getAllPlatforms().length + ' total</span>' +
            '</div>' +
            '<div class="chip-group">' +
                getAllPlatforms().map(function (platform) {
                    const selected = state.selectedPlatformIds.indexOf(platform.id) >= 0;
                    return '<button class="chip' + (selected ? ' is-active' : '') + '" type="button" data-platform-id="' + platform.id + '">' + platform.name + '</button>';
                }).join('') +
            '</div>' +
            '<form class="custom-platform-form" id="mode1-custom-form">' +
                '<div class="field"><label for="custom-name">Custom platform name</label><input class="input" id="custom-name" name="name" maxlength="40" required></div>' +
                '<div class="field"><label for="custom-commission">Commission %</label><input class="input" id="custom-commission" name="commissionPercent" type="number" min="0" max="100" step="0.01" value="2"></div>' +
                '<div class="field"><label for="custom-fixed">Fixed fee</label><input class="input" id="custom-fixed" name="fixedFee" type="number" min="0" step="0.01" value="0"></div>' +
                '<div class="field"><label for="custom-monthly">Monthly fee</label><input class="input" id="custom-monthly" name="monthlyFee" type="number" min="0" step="0.01" value="0"></div>' +
                '<div class="field"><label for="custom-withdrawal-percent">Withdrawal %</label><input class="input" id="custom-withdrawal-percent" name="withdrawalPercent" type="number" min="0" max="100" step="0.01" value="0"></div>' +
                '<div class="field"><label for="custom-withdrawal-fixed">Withdrawal fixed</label><input class="input" id="custom-withdrawal-fixed" name="withdrawalFixed" type="number" min="0" step="0.01" value="0"></div>' +
                '<div class="field"><label for="custom-days">Processing days</label><input class="input" id="custom-days" name="processingDays" type="number" min="0" step="1" value="1"></div>' +
            '</form>' +
            '<div class="form-footer">' +
                '<p class="inline-note">Add a fully manual provider and it appears instantly in chips, charts, and the comparison table.</p>' +
                '<button class="btn" type="submit" form="mode1-custom-form">Add custom</button>' +
            '</div>' +
            (state.customError ? '<div class="validation-banner">' + state.customError + '</div>' : '');
    }

    function renderResults() {
        const validationMessage = getValidationMessage();
        const selectedPlatforms = getSelectedPlatforms();

        if (!selectedPlatforms.length) {
            nodes.results.innerHTML = '' +
                '<div class="card__header"><div><p class="eyebrow">Results</p><h3>No platforms selected</h3></div></div>' +
                '<div class="empty-state"><p>Select at least one platform chip to render the live comparison.</p></div>';
            return;
        }

        if (validationMessage) {
            nodes.results.innerHTML = '' +
                '<div class="card__header"><div><p class="eyebrow">Results</p><h3>Waiting for valid inputs</h3></div></div>' +
                '<div class="validation-banner">' + validationMessage + '</div>';
            return;
        }

        const results = normalizeResults(selectedPlatforms.map(computePlatformMetrics));
        const winner = results[0];
        const bestValues = {
            totalCost: Math.min.apply(Math, results.map(function (result) { return result.values.totalCost; })),
            netAmount: Math.max.apply(Math, results.map(function (result) { return result.values.netAmount; })),
            effectiveRate: Math.max.apply(Math, results.map(function (result) { return result.values.effectiveRate; })),
            processingDays: Math.min.apply(Math, results.map(function (result) { return result.values.processingDays; })),
            score: Math.max.apply(Math, results.map(function (result) { return result.score; }))
        };

        nodes.results.innerHTML = '' +
            '<div class="result-layout">' +
                '<div class="winner-banner">' +
                    '<div>' +
                        '<p class="eyebrow">Top ranked platform</p>' +
                        '<h3>' + winner.platform.name + '</h3>' +
                        '<p class="card__intro">Weighted score ' + winner.score.toFixed(1) + '/100 with a projected net payout of ' + formatMoney(winner.values.netAmount) + '.</p>' +
                    '</div>' +
                    '<div class="mini-metrics">' +
                        '<div class="metric-tile"><span class="kicker">Total cost</span><strong>' + formatMoney(winner.values.totalCost) + '</strong></div>' +
                        '<div class="metric-tile"><span class="kicker">Effective payout</span><strong>' + winner.values.effectiveRate.toFixed(2) + '%</strong></div>' +
                        '<div class="metric-tile"><span class="kicker">Processing</span><strong>' + winner.values.processingDays.toFixed(0) + ' day(s)</strong></div>' +
                    '</div>' +
                '</div>' +
                '<div class="chart-card">' +
                    '<div class="card__header"><div><p class="eyebrow">Score chart</p><h3>Live weighted ranking</h3></div></div>' +
                    '<div class="bar-chart">' +
                        results.map(function (result) {
                            return '' +
                                '<div class="bar-chart__item">' +
                                    '<div class="bar-chart__bar" style="--bar-height:' + Math.max(result.score, 6).toFixed(2) + '"></div>' +
                                    '<div class="bar-chart__label"><strong>' + result.score.toFixed(1) + '</strong><span>' + result.platform.name + '</span></div>' +
                                '</div>';
                        }).join('') +
                    '</div>' +
                '</div>' +
                '<div class="table-wrap">' +
                    '<table class="table">' +
                        '<thead><tr><th>Platform</th><th>Total cost</th><th>Net amount</th><th>Effective payout</th><th>Processing</th><th>Score</th></tr></thead>' +
                        '<tbody>' +
                            results.map(function (result) {
                                return '' +
                                    '<tr>' +
                                        '<td>' + result.platform.name + '</td>' +
                                        '<td class="' + (result.values.totalCost === bestValues.totalCost ? 'is-best' : '') + '">' + formatMoney(result.values.totalCost) + '</td>' +
                                        '<td class="' + (result.values.netAmount === bestValues.netAmount ? 'is-best' : '') + '">' + formatMoney(result.values.netAmount) + '</td>' +
                                        '<td class="' + (result.values.effectiveRate === bestValues.effectiveRate ? 'is-best' : '') + '">' + result.values.effectiveRate.toFixed(2) + '%</td>' +
                                        '<td class="' + (result.values.processingDays === bestValues.processingDays ? 'is-best' : '') + '">' + result.values.processingDays.toFixed(0) + 'd</td>' +
                                        '<td class="' + (result.score === bestValues.score ? 'is-best' : '') + '">' + result.score.toFixed(1) + '</td>' +
                                    '</tr>';
                            }).join('') +
                        '</tbody>' +
                    '</table>' +
                '</div>' +
                '<div class="cost-grid">' +
                    results.map(function (result) {
                        return '' +
                            '<article class="cost-card">' +
                                '<div class="card__header">' +
                                    '<div><p class="eyebrow">' + result.platform.name + '</p><h4>' + formatMoney(result.values.netAmount) + ' net</h4></div>' +
                                    '<span class="badge">' + result.score.toFixed(1) + '</span>' +
                                '</div>' +
                                '<div class="cost-card__stats">' +
                                    '<div class="metric-tile"><span class="kicker">Allocated monthly fee</span><strong>' + formatMoney(result.values.allocatedMonthlyFee) + '</strong></div>' +
                                    '<div class="metric-tile"><span class="kicker">Payout speed</span><strong>' + result.values.payoutSpeed.toFixed(1) + '</strong></div>' +
                                '</div>' +
                                '<div class="cost-list">' +
                                    '<div class="cost-item"><span>Commission cost</span><strong>' + formatMoney(result.breakdown.commissionCost) + '</strong></div>' +
                                    '<div class="cost-item"><span>Fixed fee</span><strong>' + formatMoney(result.breakdown.fixedFee) + '</strong></div>' +
                                    '<div class="cost-item"><span>Withdrawal % cost</span><strong>' + formatMoney(result.breakdown.withdrawalPercentCost) + '</strong></div>' +
                                    '<div class="cost-item"><span>Withdrawal fixed</span><strong>' + formatMoney(result.breakdown.withdrawalFixed) + '</strong></div>' +
                                    '<div class="cost-item"><span>Total cost</span><strong>' + formatMoney(result.values.totalCost) + '</strong></div>' +
                                '</div>' +
                            '</article>';
                    }).join('') +
                '</div>' +
            '</div>';
    }

    function bindListeners() {
        if (listenersBound) {
            return;
        }
        listenersBound = true;

        nodes.config.addEventListener('input', function (event) {
            const field = event.target.dataset.field;
            if (!field) {
                return;
            }
            if (field === 'currency') {
                state.currency = event.target.value;
            } else if (field === 'amount') {
                state.amount = safeAmount(event.target.value);
            } else if (field === 'monthlyVolume') {
                state.monthlyVolume = safeMonthlyVolume(event.target.value || 1);
            }
            renderResults();
            renderConfig();
        });

        nodes.weights.addEventListener('input', function (event) {
            const key = event.target.dataset.weightKey;
            if (!key) {
                return;
            }
            state.weights[key] = clampNumber(event.target.value, 0, 10, 0);
            const output = nodes.weights.querySelector('[data-weight-display="' + key + '"]');
            if (output) {
                output.textContent = state.weights[key];
            }
            renderResults();
        });

        nodes.platforms.addEventListener('click', function (event) {
            const platformId = event.target.dataset.platformId;
            if (!platformId) {
                return;
            }
            const selectedIndex = state.selectedPlatformIds.indexOf(platformId);
            if (selectedIndex >= 0) {
                state.selectedPlatformIds.splice(selectedIndex, 1);
            } else {
                state.selectedPlatformIds.push(platformId);
            }
            renderPlatforms();
            renderResults();
        });

        nodes.platforms.addEventListener('submit', function (event) {
            if (event.target.id !== 'mode1-custom-form') {
                return;
            }
            event.preventDefault();
            const formData = new FormData(event.target);
            const name = String(formData.get('name') || '').trim();
            if (!name) {
                state.customError = 'Custom platforms need a non-empty name.';
                renderPlatforms();
                return;
            }

            const customPlatform = {
                id: 'custom-' + Date.now(),
                name: name,
                commissionPercent: clampNumber(formData.get('commissionPercent'), 0, 100, 0),
                fixedFee: clampNumber(formData.get('fixedFee'), 0, 1000000, 0),
                monthlyFee: clampNumber(formData.get('monthlyFee'), 0, 1000000, 0),
                withdrawalPercent: clampNumber(formData.get('withdrawalPercent'), 0, 100, 0),
                withdrawalFixed: clampNumber(formData.get('withdrawalFixed'), 0, 1000000, 0),
                processingDays: clampNumber(formData.get('processingDays'), 0, 365, 0)
            };

            state.customPlatforms.push(customPlatform);
            state.selectedPlatformIds.push(customPlatform.id);
            state.customError = '';
            event.target.reset();
            renderPlatforms();
            renderResults();
        });
    }

    function init() {
        nodes = {
            config: document.getElementById('mode1-config'),
            weights: document.getElementById('mode1-weights'),
            platforms: document.getElementById('mode1-platforms'),
            results: document.getElementById('mode1-results')
        };

        if (!nodes.config || !nodes.weights || !nodes.platforms || !nodes.results) {
            return;
        }

        renderConfig();
        renderWeights();
        renderPlatforms();
        renderResults();
        bindListeners();
    }

    window.ComissionPayMode1 = {
        init: init,
        formatValue: formatValue,
        metricMap: metricMap
    };
}());
