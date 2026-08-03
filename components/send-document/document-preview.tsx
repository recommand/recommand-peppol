import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@core/components/ui/card";
import { useTranslation } from "@core/hooks/use-translation";

interface DocumentPreviewProps {
  html: string | null;
  emptyText?: string;
}

export function DocumentPreview({
  html,
  emptyText,
}: DocumentPreviewProps) {
  const { t } = useTranslation();
  const resolvedEmptyText = emptyText ?? t`Fill in the required fields to see a preview.`;
  return (
    <Card className="lg:sticky lg:top-6">
      <CardHeader>
        <CardTitle>{t`Document preview`}</CardTitle>
        <CardDescription>
          {t`This is how your customer will see the generated billing document if you include it.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {html && (
          <div className="border rounded-md overflow-hidden bg-background">
            <iframe
              title={t`Document preview`}
              srcDoc={html}
              className="w-full h-[800px] border-0"
            />
          </div>
        )}
        {!html && <p className="text-sm text-muted-foreground">{resolvedEmptyText}</p>}
      </CardContent>
    </Card>
  );
}
