import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@core/components/ui/card";
import { Button } from "@core/components/ui/button";
import { Copy, Terminal } from "lucide-react";
import { toast } from "@core/components/ui/sonner";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@core/components/ui/tabs";
import type { SendDocument } from "@peppol/utils/parsing/send-document";
import { SyntaxHighlighter } from "./syntax-highlighter";
import { useTranslation } from "@core/hooks/use-translation";

interface ApiPreviewProps {
  formData: Partial<SendDocument>;
  companyId: string;
}

export function ApiPreview({ formData, companyId }: ApiPreviewProps) {
  const { t } = useTranslation();
  const endpoint = companyId
    ? `/api/v1/${companyId}/send`
    : "/api/v1/{companyId}/send";

  const requestBody = JSON.stringify(formData, null, 2);

  const curlCommand = `curl -X POST '${window.location.origin}${endpoint}' \\
  -H 'Content-Type: application/json' \\
  -H 'Authorization: Bearer YOUR_API_TOKEN' \\
  -d '${JSON.stringify(formData)}'`;

  const javascriptCode = `const response = await fetch('${window.location.origin}${endpoint}', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer YOUR_API_TOKEN'
  },
  body: JSON.stringify(${requestBody})
});

const data = await response.json();
console.log(data);`;

  const copyToClipboard = (text: string, type: string) => {
    navigator.clipboard.writeText(text);
    toast.success(t`${type} copied to clipboard`);
  };

  return (
    <Card className="sticky top-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Terminal className="h-5 w-5" />
          {t`API Preview`}
        </CardTitle>
        <CardDescription>
          {t`Live preview of the API request that will be sent`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">{t`Endpoint`}</span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => copyToClipboard(endpoint, "Endpoint")}
              >
                <Copy className="h-3 w-3" />
              </Button>
            </div>
            <code className="block p-2 bg-muted rounded-md text-xs">
              POST {endpoint}
            </code>
          </div>

          <Tabs defaultValue="json" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="json">JSON</TabsTrigger>
              <TabsTrigger value="curl">cURL</TabsTrigger>
              <TabsTrigger value="javascript">JavaScript</TabsTrigger>
            </TabsList>

            <TabsContent value="json" className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{t`Request Body`}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => copyToClipboard(requestBody, "JSON")}
                >
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
              <div className="h-[400px] overflow-auto w-full rounded-md border bg-card">
                <SyntaxHighlighter
                  code={requestBody}
                  language="json"
                  className="p-4 h-full min-w-full"
                />
              </div>
            </TabsContent>

            <TabsContent value="curl" className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{t`cURL Command`}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => copyToClipboard(curlCommand, "cURL command")}
                >
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
              <div className="h-[400px] overflow-auto w-full rounded-md border bg-card">
                <SyntaxHighlighter
                  code={curlCommand}
                  language="bash"
                  className="p-4 h-full min-w-full"
                />
              </div>
            </TabsContent>

            <TabsContent value="javascript" className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{t`JavaScript Fetch`}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    copyToClipboard(javascriptCode, "JavaScript code")
                  }
                >
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
              <div className="h-[400px] overflow-auto w-full rounded-md border bg-card">
                <SyntaxHighlighter
                  code={javascriptCode}
                  language="javascript"
                  className="p-4 h-full min-w-full"
                />
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </CardContent>
    </Card>
  );
}
