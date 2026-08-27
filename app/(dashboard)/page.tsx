import { PageTemplate } from "@core/components/page-template";
import { useIsPlayground } from "@peppol/lib/client/playgrounds";
import { Factory, ToyBrick } from "lucide-react";
import { useTranslation } from "@core/hooks/use-translation";

export default function Page() {
  const playground = useIsPlayground();
  const { t } = useTranslation();
  
  return (
    <PageTemplate>
      <div className="flex flex-col items-center justify-center py-12 space-y-6 h-[calc(100vh-10rem)]">
        <div className="p-6">
          <img src="/logo.svg" alt={t`Recommand Logo`} className="h-8 w-auto min-w-32" />
        </div>
        <p className="text-muted-foreground max-w-md text-center">
          {t`Manage your companies, send and receive Peppol documents, and monitor your subscription all in one place.`}
        </p>
        {playground ? (
          <div className="flex flex-col items-center justify-center bg-muted/50 border border-muted p-6 rounded-lg space-y-3 max-w-md">
            <div className="flex items-center justify-center w-10 h-10 rounded-full bg-muted">
              <ToyBrick className="w-5 h-5 text-muted-foreground" />
            </div>
            <h3 className="font-medium">{t`Playground Environment`}</h3>
            <p className="text-muted-foreground text-sm text-center">{t`This is a playground team. You can use it to test the Recommand API without affecting production data or communicating over the Peppol network.`}</p>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center bg-muted/50 border border-muted p-6 rounded-lg space-y-3 max-w-md">
            <div className="flex items-center justify-center w-10 h-10 rounded-full bg-muted">
              <Factory className="w-5 h-5 text-muted-foreground" />
            </div>
            <h3 className="font-medium">{t`Production Environment`}</h3>
            <p className="text-muted-foreground text-sm text-center">{t`This is a production team. You can use it to send and receive Peppol documents.`}<br/><br/>{t`If you want to test the Recommand API without affecting production data or communicating over the Peppol network, you can create a playground team by clicking the team switcher in the top left.`}</p>
          </div>
        )}
      </div>
    </PageTemplate>
  );
}
