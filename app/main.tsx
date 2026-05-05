import React, { useEffect } from "react";
import {
  CreditCard,
  Building,
  History,
  Webhook,
  Send,
  Tag,
  Database,
  Truck,
  Users,
} from "lucide-react";
import { useMenuItemActions } from "@core/lib/menu-store";
import { useOnboardingActions } from "@core/lib/onboarding-store";
import BillingOnboarding from "@peppol/components/onboarding/billing";
import SubscriptionOnboarding from "@peppol/components/onboarding/subscription";
import CompanyOnboarding from "@peppol/components/onboarding/company";
import AddPlayground from "./add-playground";
import PlaygroundUI from "./playground-ui";

export default function Main({ children }: { children: React.ReactNode }) {
  const { registerMenuItem } = useMenuItemActions();
  const { registerOnboardingStep } = useOnboardingActions();

  useEffect(() => {
    registerMenuItem({
      id: "main.send",
      title: "Send document",
      icon: Send,
      href: "/send-document",
    });

    registerMenuItem({
      id: "main.history",
      title: "Sent and received",
      icon: History,
      href: "/transmitted-documents",
    });

    registerMenuItem({
      id: "main.companies",
      title: "Companies",
      icon: Building,
      href: "/companies",
    });

    registerMenuItem({
      id: "main.labels",
      title: "Labels",
      icon: Tag,
      href: "/labels",
    });

    registerMenuItem({
      id: "main.supporting-data",
      title: "Supporting data",
      icon: Database,
    });

    registerMenuItem({
      id: "main.supporting-data.suppliers",
      title: "Suppliers",
      icon: Truck,
      href: "/suppliers",
    });

    registerMenuItem({
      id: "main.supporting-data.customers",
      title: "Customers",
      icon: Users,
      href: "/customers",
    });

    registerMenuItem({
      id: "user.billing.subscription",
      title: "Subscription",
      icon: CreditCard,
      href: "/billing/subscription",
    });

    registerMenuItem({
      id: "user.api.webhooks",
      title: "Webhooks and rules",
      icon: Webhook,
      href: "/webhooks",
    });

    registerOnboardingStep({
      id: "peppol.subscription",
      scope: "team",
      title: "Pick a plan",
      description:
        "We offer a variety of plans, pick one that suits your needs.",
      render: ({ onComplete }) => {
        return <SubscriptionOnboarding onComplete={onComplete} />;
      },
    });

    registerOnboardingStep({
      id: "peppol.billing",
      scope: "team",
      title: "Create a billing profile",
      description: "A billing profile is required to get started.",
      render: ({ onComplete }) => {
        return <BillingOnboarding onComplete={onComplete} />;
      },
    });

    registerOnboardingStep({
      id: "peppol.company",
      scope: "team",
      title: "Set up your first company",
      description: "Companies are the legal entities you send or receive Peppol documents for.",
      render: ({ onComplete }) => {
        return <CompanyOnboarding onComplete={onComplete} />;
      },
    });
  }, [registerMenuItem]);

  return (
    <>
      {children}
      <AddPlayground />
      <PlaygroundUI />
    </>
  );
}
