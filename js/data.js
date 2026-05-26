(function () {
    const metrics = [
        { key: 'commissionPercent', label: 'Commission %', kind: 'base', preference: 'low', description: 'Lower percentage-based deductions preserve more of the payment.' },
        { key: 'fixedFee', label: 'Fixed fee', kind: 'base', preference: 'low', description: 'Flat transaction charge per payout.' },
        { key: 'monthlyFee', label: 'Monthly fee', kind: 'base', preference: 'low', description: 'Recurring platform cost before volume allocation.' },
        { key: 'withdrawalPercent', label: 'Withdrawal %', kind: 'base', preference: 'low', description: 'Percentage deducted during withdrawal or settlement.' },
        { key: 'withdrawalFixed', label: 'Withdrawal fixed', kind: 'base', preference: 'low', description: 'Fixed amount charged on payout extraction.' },
        { key: 'processingDays', label: 'Processing days', kind: 'base', preference: 'low', description: 'Settlement delay in days.' },
        { key: 'allocatedMonthlyFee', label: 'Allocated monthly fee', kind: 'derived', preference: 'low', description: 'Monthly cost distributed across the configured volume.' },
        { key: 'totalCost', label: 'Total cost', kind: 'derived', preference: 'low', description: 'Blended payout deduction for the active transaction amount.' },
        { key: 'netAmount', label: 'Net amount', kind: 'derived', preference: 'high', description: 'Final amount received after all deductions.' },
        { key: 'effectiveRate', label: 'Effective payout %', kind: 'derived', preference: 'high', description: 'Share of the original transaction retained as net payout.' },
        { key: 'payoutSpeed', label: 'Payout speed index', kind: 'derived', preference: 'high', description: 'Derived speed score favoring faster processing.' }
    ];

    const platformPresets = [
        { id: 'stripe', name: 'Stripe', commissionPercent: 2.9, fixedFee: 0.3, monthlyFee: 0, withdrawalPercent: 0, withdrawalFixed: 0.25, processingDays: 2 },
        { id: 'paypal', name: 'PayPal', commissionPercent: 3.49, fixedFee: 0.49, monthlyFee: 0, withdrawalPercent: 0, withdrawalFixed: 0.25, processingDays: 1 },
        { id: 'wise', name: 'Wise Business', commissionPercent: 1.25, fixedFee: 0.45, monthlyFee: 9, withdrawalPercent: 0.35, withdrawalFixed: 0.2, processingDays: 1 },
        { id: 'adyen', name: 'Adyen', commissionPercent: 2.2, fixedFee: 0.22, monthlyFee: 18, withdrawalPercent: 0.1, withdrawalFixed: 0.15, processingDays: 2 },
        { id: 'square', name: 'Square', commissionPercent: 2.6, fixedFee: 0.1, monthlyFee: 0, withdrawalPercent: 0, withdrawalFixed: 0.25, processingDays: 1 },
        { id: 'mollie', name: 'Mollie', commissionPercent: 1.8, fixedFee: 0.29, monthlyFee: 0, withdrawalPercent: 0.15, withdrawalFixed: 0.1, processingDays: 2 },
        { id: 'checkout', name: 'Checkout.com', commissionPercent: 2.45, fixedFee: 0.24, monthlyFee: 15, withdrawalPercent: 0.05, withdrawalFixed: 0.12, processingDays: 3 },
        { id: 'authorize', name: 'Authorize.net', commissionPercent: 2.7, fixedFee: 0.3, monthlyFee: 25, withdrawalPercent: 0.12, withdrawalFixed: 0.18, processingDays: 2 }
    ];

    const defaultMode1Weights = {
        commissionPercent: 9,
        fixedFee: 7,
        monthlyFee: 5,
        withdrawalPercent: 6,
        withdrawalFixed: 5,
        processingDays: 4,
        allocatedMonthlyFee: 6,
        totalCost: 10,
        netAmount: 10,
        effectiveRate: 9,
        payoutSpeed: 4
    };

    const defaultMode2Weights = {
        commissionPercent: 8,
        fixedFee: 7,
        monthlyFee: 4,
        withdrawalPercent: 7,
        withdrawalFixed: 5,
        processingDays: 8,
        allocatedMonthlyFee: 4,
        totalCost: 10,
        netAmount: 10,
        effectiveRate: 9,
        payoutSpeed: 8
    };

    window.ComissionPayData = {
        metrics: metrics,
        baseMetricKeys: metrics.filter(function (metric) { return metric.kind === 'base'; }).map(function (metric) { return metric.key; }),
        derivedMetricKeys: metrics.filter(function (metric) { return metric.kind === 'derived'; }).map(function (metric) { return metric.key; }),
        platformPresets: platformPresets,
        defaultMode1Weights: defaultMode1Weights,
        defaultMode2Weights: defaultMode2Weights
    };
}());
