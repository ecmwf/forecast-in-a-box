import { NextResponse } from "next/server";

const categories = {
  ensemble: {
    title: "Ensemble",
    description: "Capture the distribution of the ensemble",
    options: ['Quantiles', 'EFI', 'ENSMS', 'Threshold']
  },
  deterministic: {
    title: "Deterministic",
    description: "Deterministic Products",
    options: ['Vertical Profile', 'WindSpeed']
  },
  extreme: {
    title: "Extereme Events",
    description: "Deterministic Products",
    options: ['Quantiles', 'EFI', 'ENSMS']
  },
  anomalises: {
    title: "Climatological Anomalies",
    description: "Deterministic Products",
    options: ['Quantiles', 'EFI', 'ENSMS']
  },
  instance: {
    title: "Instance Defined",
    description: "Deterministic Products",
    options: ['Quantiles', 'EFI', 'ENSMS']
  },
  user: {
    title: "User Defined",
    description: "Deterministic Products",
    options: ['Quantiles', 'EFI', 'ENSMS']
  }
};


export async function GET() {
  return NextResponse.json(categories);
}
