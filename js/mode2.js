(function () {
    const data = window.ComissionPayData;
    const metrics = data.metrics;

    const state = {
        amount: 1200,
        currency: 'USD',
        monthlyVolume: 120,
        weights: Object.assign({}, data.defaultMode2Weights),
        routes: [createRoute(1)]
    };

    let nodes = {};
    let listenersBound = false;

    function createStep(index) {
        return {
            id: 'step-' + Date.now() + '-' + Math.random().toString(16).slice(2),
            name: 'Step ' + (index + 1),
            commissionPercent: 0,
            fixedFee: 0,
            monthlyFee: 0,
            withdrawalPercent: 0,
            withdrawalFixed: 0,
            processingDays: 0
        };
    }

    function createRoute(index) {
        return {
            id: 'route-' + Date.now() + '-' + Math.random().toString(16).slice(2),
            name: 'Route ' + index,
            steps: [createStep(0)]
        };
    }

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

    function getValidationMessage() {
        if (safeAmount(state.amount) <= 0) {
            return 'Set a transaction amount greater than zero to evaluate route nets and chain scores.';
        }
        return '';
    }

    function computeStepImpact(step, currentAmount) {
        const monthlyVolume = safeMonthlyVolume(state.monthlyVolume);
        const commissionCost = currentAmount * (step.commissionPercent / 100);
        const fixedFee = step.fixedFee;
        const allocatedMonthlyFee = step.monthlyFee / monthlyVolume;
        const withdrawalPercentCost = currentAmount * (step.withdrawalPercent / 100);
        const withdrawalFixed = step.withdrawalFixed;
        const totalCost = commissionCost + fixedFee + allocatedMonthlyFee + withdrawalPercentCost + withdrawalFixed;
        const nextAmount = Math.max(currentAmount - totalCost, 0);

        return {
            name: step.name && step.name.trim() ? step.name.trim() : 'Untitled step',
            commissionCost: commissionCost,
            fixedFee: fixedFee,
            rawMonthlyFee: step.monthlyFee,
            allocatedMonthlyFee: allocatedMonthlyFee,
            withdrawalPercentCost: withdrawalPercentCost,
            withdrawalFixed: withdrawalFixed,
            processingDays: step.processingDays,
            totalCost: totalCost,
            nextAmount: nextAmount,
            currentAmount: currentAmount
        };
    }

    function computeRoute(route) {
        const startingAmount = safeAmount(state.amount);
        let currentAmount = startingAmount;
        let totalCommissionCost = 0;
        let totalWithdrawalPercentCost = 0;
        let totalFixedFee = 0;
        let totalWithdrawalFixed = 0;
        let totalMonthlyFee = 0;
        let totalAllocatedMonthlyFee = 0;
        let processingDays = 0;

        const steps = route.steps.map(function (step) {
            const impact = computeStepImpact(step, currentAmount);
            currentAmount = impact.nextAmount;
            totalCommissionCost += impact.commissionCost;
            totalWithdrawalPercentCost += impact.withdrawalPercentCost;
            totalFixedFee += impact.fixedFee;
            totalWithdrawalFixed += impact.withdrawalFixed;
            totalMonthlyFee += impact.rawMonthlyFee;
            totalAllocatedMonthlyFee += impact.allocatedMonthlyFee;
            processingDays += impact.processingDays;
            impact.cumulativeDeduction = startingAmount - currentAmount;
            return impact;
        });

        const totalCost = startingAmount - currentAmount;
        const effectiveRate = startingAmount > 0 ? (currentAmount / startingAmount) * 100 : 0;
        const payoutSpeed = 100 / (processingDays + 1);
        let costliestStep = null;

        steps.forEach(function (step) {
            if (!costliestStep || step.totalCost > costliestStep.totalCost) {
                costliestStep = step;
            }
        });

        return {
            id: route.id,
            name: route.name && route.name.trim() ? route.name.trim() : 'Untitled route',
            steps: steps,
            totalCost: totalCost,
            finalNetAmount: currentAmount,
            effectiveRate: effectiveRate,
            payoutSpeed: payoutSpeed,
            processingDays: processingDays,
            costliestStep: costliestStep,
            values: {
                commissionPercent: startingAmount > 0 ? (totalCommissionCost / startingAmount) * 100 : 0,
                fixedFee: totalFixedFee,
                monthlyFee: totalMonthlyFee,
                withdrawalPercent: startingAmount > 0 ? (totalWithdrawalPercentCost / startingAmount) * 100 : 0,
                withdrawalFixed: totalWithdrawalFixed,
                processingDays: processingDays,
                allocatedMonthlyFee: totalAllocatedMonthlyFee,
                totalCost: totalCost,
                netAmount: currentAmount,
                effectiveRate: effectiveRate,
                payoutSpeed: payoutSpeed
            }
        };
    }

    function normalizeRoutes(routes) {
        if (!routes.length) {
            return [];
        }

        const ranges = metrics.reduce(function (accumulator, metric) {
            const values = routes.map(function (route) { return route.values[metric.key]; });
            accumulator[metric.key] = {
                min: Math.min.apply(Math, values),
                max: Math.max.apply(Math, values)
            };
            return accumulator;
        }, {});

        return routes.map(function (route) {
            let weightedTotal = 0;
            let totalWeight = 0;
            route.normalized = {};

            metrics.forEach(function (metric) {
                const range = ranges[metric.key];
                const raw = route.values[metric.key];
                let score = 100;

                if (range.max !== range.min) {
                    if (metric.preference === 'low') {
                        score = ((range.max - raw) / (range.max - range.min)) * 100;
                    } else {
                        score = ((raw - range.min) / (range.max - range.min)) * 100;
                    }
                }

                route.normalized[metric.key] = score;
                const weight = state.weights[metric.key] || 0;
                totalWeight += weight;
                weightedTotal += score * weight;
            });

            route.score = totalWeight > 0 ? weightedTotal / totalWeight : 0;
            return route;
        });
    }

    function renderConfig() {
        nodes.config.innerHTML = '' +
            '<div class="card__header">' +
                '<div><p class="eyebrow">Route scenario</p><h3>Global flow inputs</h3></div>' +
                '<div class="card__actions"><button class="btn" type="button" data-add-route="true">Add route</button></div>' +
            '</div>' +
            '<div class="grid-fields">' +
                '<div class="field"><label for="mode2-amount">Starting amount</label><input class="input" id="mode2-amount" type="number" min="0" step="0.01" data-field="amount" value="' + state.amount + '"></div>' +
                '<div class="field"><label for="mode2-currency">Currency</label><select class="select" id="mode2-currency" data-field="currency"><option value="USD"' + (state.currency === 'USD' ? ' selected' : '') + '>USD</option><option value="EUR"' + (state.currency === 'EUR' ? ' selected' : '') + '>EUR</option><option value="GBP"' + (state.currency === 'GBP' ? ' selected' : '') + '>GBP</option></select></div>' +
                '<div class="field"><label for="mode2-volume">Monthly volume</label><input class="input" id="mode2-volume" type="number" min="1" step="1" data-field="monthlyVolume" value="' + state.monthlyVolume + '"></div>' +
            '</div>' +
            '<p class="help-text">Monthly volume spreads monthly step fees across expected transaction throughput.</p>' +
            (getValidationMessage() ? '<div class="validation-banner">' + getValidationMessage() + '</div>' : '');
    }

    function renderWeights() {
        nodes.weights.innerHTML = '' +
            '<div class="card__header">' +
                '<div><p class="eyebrow">Chain weighting</p><h3>Mode 2 score weights</h3></div>' +
                '<span class="badge badge--success">Independent</span>' +
            '</div>' +
            '<div class="slider-group">' +
                metrics.map(function (metric) {
                    return '' +
                        '<label class="slider-row" for="mode2-weight-' + metric.key + '">' +
                            '<div><strong>' + metric.label + '</strong><small>' + metric.description + '</small></div>' +
                            '<input class="slider" id="mode2-weight-' + metric.key + '" type="range" min="0" max="10" step="1" data-weight-key="' + metric.key + '" value="' + state.weights[metric.key] + '">' +
                            '<span class="slider-badge" data-weight-display="' + metric.key + '">' + state.weights[metric.key] + '</span>' +
                        '</label>';
                }).join('') +
            '</div>';
    }

    function renderRoutes() {
        nodes.routes.innerHTML = '' +
            '<div class="card__header">' +
                '<div><p class="eyebrow">Routes</p><h3>Transaction chains</h3></div>' +
                '<span class="badge badge--warning">' + state.routes.length + ' route(s)</span>' +
            '</div>' +
            (state.routes.length ? '<div class="route-grid">' + state.routes.map(function (route, routeIndex) {
                return '' +
                    '<article class="route-card" data-route-id="' + route.id + '">' +
                        '<div class="route-card__header">' +
                            '<div class="field" style="flex:1;">' +
                                '<label for="route-name-' + route.id + '">Route name</label>' +
                                '<input class="input" id="route-name-' + route.id + '" data-route-name="' + route.id + '" value="' + route.name + '">' +
                            '</div>' +
                            '<div class="route-card__controls">' +
                                '<button class="btn btn--ghost" type="button" data-add-step="' + route.id + '">Add step</button>' +
                                '<button class="btn btn--ghost" type="button" data-remove-route="' + route.id + '">Remove</button>' +
                            '</div>' +
                        '</div>' +
                        '<div class="steps-stack">' +
                            (route.steps.length ? route.steps.map(function (step, stepIndex) {
                                return '' +
                                    '<section class="step-card">' +
                                        '<div class="step-card__header">' +
                                            '<strong>Step ' + (stepIndex + 1) + '</strong>' +
                                            '<div class="step-actions">' +
                                                '<button class="icon-btn" type="button" data-move-step="up" data-route-id="' + route.id + '" data-step-id="' + step.id + '"' + (stepIndex === 0 ? ' disabled' : '') + '>↑</button>' +
                                                '<button class="icon-btn" type="button" data-move-step="down" data-route-id="' + route.id + '" data-step-id="' + step.id + '"' + (stepIndex === route.steps.length - 1 ? ' disabled' : '') + '>↓</button>' +
                                                '<button class="icon-btn" type="button" data-remove-step="' + step.id + '" data-route-id="' + route.id + '">✕</button>' +
                                            '</div>' +
                                        '</div>' +
                                        '<div class="step-form-grid">' +
                                            '<div class="step-field"><label>Name</label><input data-step-field="name" data-route-id="' + route.id + '" data-step-id="' + step.id + '" value="' + step.name + '"></div>' +
                                            '<div class="step-field"><label>Commission %</label><input type="number" min="0" max="100" step="0.01" data-step-field="commissionPercent" data-route-id="' + route.id + '" data-step-id="' + step.id + '" value="' + step.commissionPercent + '"></div>' +
                                            '<div class="step-field"><label>Fixed fee</label><input type="number" min="0" step="0.01" data-step-field="fixedFee" data-route-id="' + route.id + '" data-step-id="' + step.id + '" value="' + step.fixedFee + '"></div>' +
                                            '<div class="step-field"><label>Monthly fee</label><input type="number" min="0" step="0.01" data-step-field="monthlyFee" data-route-id="' + route.id + '" data-step-id="' + step.id + '" value="' + step.monthlyFee + '"></div>' +
                                            '<div class="step-field"><label>Withdrawal %</label><input type="number" min="0" max="100" step="0.01" data-step-field="withdrawalPercent" data-route-id="' + route.id + '" data-step-id="' + step.id + '" value="' + step.withdrawalPercent + '"></div>' +
                                            '<div class="step-field"><label>Withdrawal fixed</label><input type="number" min="0" step="0.01" data-step-field="withdrawalFixed" data-route-id="' + route.id + '" data-step-id="' + step.id + '" value="' + step.withdrawalFixed + '"></div>' +
                                            '<div class="step-field"><label>Processing days</label><input type="number" min="0" step="1" data-step-field="processingDays" data-route-id="' + route.id + '" data-step-id="' + step.id + '" value="' + step.processingDays + '"></div>' +
                                        '</div>' +
                                    '</section>';
                            }).join('') : '<div class="empty-state"><p>This route has no steps yet. Add one to start the waterfall.</p></div>') +
                        '</div>' +
                        '<div class="route-card__footer"><span class="inline-note">Sequential deductions are applied from the remaining amount at each step.</span><button class="btn btn--ghost" type="button" data-add-step="' + route.id + '">+ Step</button></div>' +
                    '</article>';
            }).join('') + '</div>' : '<div class="empty-state"><p>Add a route to compare transaction flows side by side.</p></div>');
    }

    function renderResults() {
        if (!state.routes.length) {
            nodes.results.innerHTML = '' +
                '<div class="card__header"><div><p class="eyebrow">Results</p><h3>No routes yet</h3></div></div>' +
                '<div class="empty-state"><p>Create at least one route to inspect costs, score chains, and visualize the waterfall.</p></div>';
            return;
        }

        const validationMessage = getValidationMessage();
        if (validationMessage) {
            nodes.results.innerHTML = '' +
                '<div class="card__header"><div><p class="eyebrow">Results</p><h3>Waiting for valid inputs</h3></div></div>' +
                '<div class="validation-banner">' + validationMessage + '</div>';
            return;
        }

        const normalizedRoutes = normalizeRoutes(state.routes.map(computeRoute));
        const bestRoute = normalizedRoutes.reduce(function (currentBest, route) {
            return !currentBest || route.score > currentBest.score ? route : currentBest;
        }, null);

        nodes.results.innerHTML = '' +
            '<div class="mode2-results">' +
                '<div class="winner-banner">' +
                    '<div><p class="eyebrow">Best weighted chain</p><h3>' + bestRoute.name + '</h3><p class="card__intro">Weighted score ' + bestRoute.score.toFixed(1) + '/100 with a final net of ' + formatMoney(bestRoute.finalNetAmount) + ' after ' + bestRoute.processingDays.toFixed(0) + ' total day(s).</p></div>' +
                    '<div class="mini-metrics">' +
                        '<div class="metric-tile"><span class="kicker">Total cost</span><strong>' + formatMoney(bestRoute.totalCost) + '</strong></div>' +
                        '<div class="metric-tile"><span class="kicker">Most expensive step</span><strong>' + (bestRoute.costliestStep ? bestRoute.costliestStep.name : '—') + '</strong></div>' +
                    '</div>' +
                '</div>' +
                '<div>' +
                    '<div class="card__header"><div><p class="eyebrow">Route comparison</p><h3>Side-by-side net outcomes</h3></div></div>' +
                    '<div class="summary-grid">' +
                        normalizedRoutes.map(function (route) {
                            return '' +
                                '<article class="summary-card">' +
                                    '<p class="eyebrow">' + route.name + '</p>' +
                                    '<h4>' + route.score.toFixed(1) + '/100</h4>' +
                                    '<strong>' + formatMoney(route.finalNetAmount) + '</strong>' +
                                    '<div class="route-breakdown">' +
                                        '<div class="route-breakdown__row"><span>Total cost</span><strong>' + formatMoney(route.totalCost) + '</strong></div>' +
                                        '<div class="route-breakdown__row"><span>Effective payout</span><strong>' + route.effectiveRate.toFixed(2) + '%</strong></div>' +
                                        '<div class="route-breakdown__row"><span>Processing time</span><strong>' + route.processingDays.toFixed(0) + 'd</strong></div>' +
                                    '</div>' +
                                '</article>';
                        }).join('') +
                    '</div>' +
                '</div>' +
                '<div class="route-analysis-grid">' +
                    normalizedRoutes.map(function (route) {
                        return '' +
                            '<article class="route-analysis">' +
                                '<div class="card__header">' +
                                    '<div><p class="eyebrow">' + route.name + '</p><h4>' + formatMoney(route.finalNetAmount) + ' final net</h4></div>' +
                                    '<span class="badge ' + (route.costliestStep ? 'badge--danger' : '') + '">' + route.score.toFixed(1) + '</span>' +
                                '</div>' +
                                '<div class="route-key-metrics">' +
                                    '<div class="metric-tile"><span class="kicker">Total cost</span><strong>' + formatMoney(route.totalCost) + '</strong></div>' +
                                    '<div class="metric-tile"><span class="kicker">Allocated monthly fee</span><strong>' + formatMoney(route.values.allocatedMonthlyFee) + '</strong></div>' +
                                    '<div class="metric-tile"><span class="kicker">Payout speed</span><strong>' + route.values.payoutSpeed.toFixed(1) + '</strong></div>' +
                                '</div>' +
                                '<div class="chart-card">' +
                                    '<div class="card__header"><div><p class="eyebrow">Waterfall</p><h4>Cumulative deduction by step</h4></div></div>' +
                                    '<div class="waterfall">' +
                                        (route.steps.length ? route.steps.map(function (step) {
                                            const height = safeAmount(state.amount) > 0 ? (step.cumulativeDeduction / safeAmount(state.amount)) * 100 : 0;
                                            return '' +
                                                '<div class="waterfall__segment' + (route.costliestStep && route.costliestStep.name === step.name && route.costliestStep.totalCost === step.totalCost ? ' is-max' : '') + '">' +
                                                    '<div class="waterfall__bar" style="--segment-height:' + Math.max(height, 8).toFixed(2) + '"></div>' +
                                                    '<div class="waterfall__meta"><strong>' + step.name + '</strong><span>' + formatMoney(step.totalCost) + ' · cum. ' + formatMoney(step.cumulativeDeduction) + '</span></div>' +
                                                '</div>';
                                        }).join('') : '<div class="empty-state"><p>No steps yet for this route.</p></div>') +
                                    '</div>' +
                                '</div>' +
                                '<div class="route-breakdown">' +
                                    '<div class="route-breakdown__row"><span>Most expensive step</span><strong>' + (route.costliestStep ? route.costliestStep.name + ' (' + formatMoney(route.costliestStep.totalCost) + ')' : '—') + '</strong></div>' +
                                    '<div class="route-breakdown__row"><span>Final net</span><strong>' + formatMoney(route.finalNetAmount) + '</strong></div>' +
                                    '<div class="route-breakdown__row"><span>Weighted score</span><strong>' + route.score.toFixed(1) + '</strong></div>' +
                                '</div>' +
                            '</article>';
                    }).join('') +
                '</div>' +
            '</div>';
    }

    function findRoute(routeId) {
        return state.routes.find(function (route) { return route.id === routeId; });
    }

    function bindListeners() {
        if (listenersBound) {
            return;
        }
        listenersBound = true;

        nodes.config.addEventListener('click', function (event) {
            if (!event.target.dataset.addRoute) {
                return;
            }
            state.routes.push(createRoute(state.routes.length + 1));
            renderRoutes();
            renderResults();
        });

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
            renderConfig();
            renderResults();
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

        nodes.routes.addEventListener('click', function (event) {
            const addStepRouteId = event.target.dataset.addStep;
            const removeRouteId = event.target.dataset.removeRoute;
            const removeStepId = event.target.dataset.removeStep;
            const moveDirection = event.target.dataset.moveStep;

            if (addStepRouteId) {
                const route = findRoute(addStepRouteId);
                if (route) {
                    route.steps.push(createStep(route.steps.length));
                    renderRoutes();
                    renderResults();
                }
                return;
            }

            if (removeRouteId) {
                state.routes = state.routes.filter(function (route) { return route.id !== removeRouteId; });
                renderRoutes();
                renderResults();
                return;
            }

            if (removeStepId) {
                const route = findRoute(event.target.dataset.routeId);
                if (route) {
                    route.steps = route.steps.filter(function (step) { return step.id !== removeStepId; });
                    renderRoutes();
                    renderResults();
                }
                return;
            }

            if (moveDirection) {
                const route = findRoute(event.target.dataset.routeId);
                if (route) {
                    const index = route.steps.findIndex(function (step) { return step.id === event.target.dataset.stepId; });
                    const offset = moveDirection === 'up' ? -1 : 1;
                    const targetIndex = index + offset;
                    if (index >= 0 && targetIndex >= 0 && targetIndex < route.steps.length) {
                        const swapped = route.steps[targetIndex];
                        route.steps[targetIndex] = route.steps[index];
                        route.steps[index] = swapped;
                        renderRoutes();
                        renderResults();
                    }
                }
            }
        });

        nodes.routes.addEventListener('input', function (event) {
            const routeNameId = event.target.dataset.routeName;
            if (routeNameId) {
                const route = findRoute(routeNameId);
                if (route) {
                    route.name = event.target.value;
                    renderResults();
                }
                return;
            }

            const field = event.target.dataset.stepField;
            if (!field) {
                return;
            }

            const route = findRoute(event.target.dataset.routeId);
            if (!route) {
                return;
            }
            const step = route.steps.find(function (entry) { return entry.id === event.target.dataset.stepId; });
            if (!step) {
                return;
            }

            if (field === 'name') {
                step.name = event.target.value;
            } else if (field === 'processingDays') {
                step[field] = clampNumber(event.target.value, 0, 365, 0);
            } else if (field === 'commissionPercent' || field === 'withdrawalPercent') {
                step[field] = clampNumber(event.target.value, 0, 100, 0);
            } else {
                step[field] = clampNumber(event.target.value, 0, 1000000000, 0);
            }
            renderResults();
        });
    }

    function init() {
        nodes = {
            config: document.getElementById('mode2-config'),
            weights: document.getElementById('mode2-weights'),
            routes: document.getElementById('mode2-routes'),
            results: document.getElementById('mode2-results')
        };

        if (!nodes.config || !nodes.weights || !nodes.routes || !nodes.results) {
            return;
        }

        renderConfig();
        renderWeights();
        renderRoutes();
        renderResults();
        bindListeners();
    }

    window.ComissionPayMode2 = {
        init: init
    };
}());
