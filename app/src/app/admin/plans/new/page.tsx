import Link from "next/link";
import { PageHeader } from "@/components/admin/ui";
import { getSettings } from "@/lib/settings";
import { PlanForm } from "../plan-form";

export const metadata = { title: "Add plan" };

export default async function NewPlanPage() {
  const settings = await getSettings();
  return (
    <>
      <PageHeader
        title="Add plan"
        description={
          <Link href="/admin/plans" className="text-primary hover:underline">
            Back to plans
          </Link>
        }
      />
      <PlanForm
        currency={settings.currency}
        plan={{
          id: null,
          name: "",
          description: "",
          priceMonthly: "0.00",
          priceYearly: "0.00",
          features: "",
          maxPrograms: 3,
          maxAffiliates: 1000,
          maxMonthlyConversions: 2000,
          allowApi: true,
          removeBranding: true,
          isFree: false,
          isActive: true,
          isFeatured: false,
          sortOrder: 10,
        }}
      />
    </>
  );
}
