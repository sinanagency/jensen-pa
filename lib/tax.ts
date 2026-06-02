// UAE tax ruleset. THIS is the source of truth for any tax figure in the app.
// The mentor is instructed never to quote tax numbers from memory; it defers
// here. Figures below are maintained and must be reviewed against the FTA before
// relying on them for filing. Update `lastReviewed` whenever you confirm them.

export const UAE_TAX = {
  lastReviewed: "2026-06-02",
  source: "UAE Federal Tax Authority (FTA). Verify before filing.",
  vat: {
    standardRate: 0.05, // 5%
    mandatoryRegThreshold: 375_000, // AED annual taxable supplies
    voluntaryRegThreshold: 187_500, // AED
    filingNote:
      "VAT returns are generally filed quarterly, due within 28 days of the end of the tax period.",
  },
  corporateTax: {
    effectiveFrom: "Financial years starting on or after 1 June 2023",
    zeroBandUpTo: 375_000, // AED taxable income taxed at 0%
    rateAboveBand: 0.09, // 9% on taxable income above the band
    smallBusinessReliefRevenueCap: 3_000_000, // AED: may elect 0% if revenue at or below, for eligible periods
    note: "Large multinationals (group revenue above EUR 750m) face a separate top-up tax, not relevant here.",
  },
  personalIncomeTax: 0, // no personal income tax in the UAE
} as const;

export type VatResult = { net: number; vat: number; gross: number; rate: number };

export function vatFromNet(net: number): VatResult {
  const rate = UAE_TAX.vat.standardRate;
  const vat = round2(net * rate);
  return { net: round2(net), vat, gross: round2(net + vat), rate };
}

export function vatFromGross(gross: number): VatResult {
  const rate = UAE_TAX.vat.standardRate;
  const net = round2(gross / (1 + rate));
  return { net, vat: round2(gross - net), gross: round2(gross), rate };
}

export type CtResult = {
  taxableIncome: number;
  zeroBand: number;
  taxedAmount: number;
  rate: number;
  tax: number;
  effectiveRate: number;
  smallBusinessReliefMayApply: boolean;
};

export function corporateTax(taxableIncome: number, annualRevenue?: number): CtResult {
  const ct = UAE_TAX.corporateTax;
  const taxed = Math.max(0, taxableIncome - ct.zeroBandUpTo);
  const tax = round2(taxed * ct.rateAboveBand);
  return {
    taxableIncome: round2(taxableIncome),
    zeroBand: ct.zeroBandUpTo,
    taxedAmount: round2(taxed),
    rate: ct.rateAboveBand,
    tax,
    effectiveRate: taxableIncome > 0 ? round4(tax / taxableIncome) : 0,
    smallBusinessReliefMayApply:
      typeof annualRevenue === "number" && annualRevenue <= ct.smallBusinessReliefRevenueCap,
  };
}

export function round2(n: number): number { return Math.round(n * 100) / 100; }
export function round4(n: number): number { return Math.round(n * 10000) / 10000; }

export function aed(n: number): string {
  return "AED " + n.toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
