export interface GstCalculationResult {
  taxableBase: number;
  totalGst: number;
  cgst: number;
  sgst: number;
  igst: number;
  isInterState: boolean;
  gstRate: number;
  totalAmount: number;
}

export function calculateGstFromInclusiveTotal(
  inclusiveTotal: number,
  studentState: string | null | undefined
): GstCalculationResult {
  const gstRate = Number(process.env.GST_RATE);
  const academyState = (process.env.ACADEMY_STATE || "").trim().toLowerCase();

  if (!Number.isFinite(gstRate) || gstRate < 0 || gstRate > 100) {
    throw new Error("GST_RATE must be configured as a percentage between 0 and 100.");
  }

  if (!academyState) {
    throw new Error("ACADEMY_STATE must be configured before issuing a GST invoice.");
  }
  
  const studentStateNormalized = (studentState || "").trim().toLowerCase();
  const isInterState =
    studentStateNormalized !== "" &&
    academyState !== "" &&
    studentStateNormalized !== academyState;

  if (gstRate <= 0 || inclusiveTotal <= 0) {
    return {
      taxableBase: inclusiveTotal,
      totalGst: 0,
      cgst: 0,
      sgst: 0,
      igst: 0,
      isInterState,
      gstRate: 0,
      totalAmount: inclusiveTotal,
    };
  }

  // Reverse calculate taxable base from inclusive total
  // Total = Base * (1 + Rate / 100)
  // Base = Total / (1 + Rate / 100)
  const taxableBase = inclusiveTotal / (1 + gstRate / 100);
  const totalGst = inclusiveTotal - taxableBase;

  let cgst = 0;
  let sgst = 0;
  let igst = 0;

  if (isInterState) {
    igst = totalGst;
  } else {
    cgst = totalGst / 2;
    sgst = totalGst / 2;
  }

  return {
    taxableBase: Number(taxableBase.toFixed(2)),
    totalGst: Number(totalGst.toFixed(2)),
    cgst: Number(cgst.toFixed(2)),
    sgst: Number(sgst.toFixed(2)),
    igst: Number(igst.toFixed(2)),
    isInterState,
    gstRate,
    totalAmount: inclusiveTotal,
  };
}
