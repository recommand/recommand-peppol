import { useState, useEffect, useRef } from "react";
import { Input } from "@core/components/ui/input";
import { Label } from "@core/components/ui/label";
import { Textarea } from "@core/components/ui/textarea";
import { Switch } from "@core/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@core/components/ui/select";
import { Button } from "@core/components/ui/button";
import { Plus, Trash2, Mail } from "lucide-react";
import { Card } from "@core/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@core/components/ui/collapsible";
import { ChevronDown } from "lucide-react";
import { useTranslation } from "@core/hooks/use-translation";

interface EmailOptionsProps {
  value?: {
    when: "always" | "on_peppol_failure";
    to: string[];
    subject?: string;
    htmlBody?: string;
  };
  onChange: (value: any) => void;
  suggestedEmail?: string | null;
}

export function EmailOptions({
  value,
  onChange,
  suggestedEmail,
}: EmailOptionsProps) {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(!!value);
  const [emails, setEmails] = useState(value?.to || [""]);
  const [when, setWhen] = useState(value?.when || "on_peppol_failure");
  const [subject, setSubject] = useState(value?.subject || "");
  const [htmlBody, setHtmlBody] = useState(value?.htmlBody || "");
  const [isOpen, setIsOpen] = useState(false);
  const lastAutoEmailRef = useRef<string | null>(null);

  useEffect(() => {
    if (!suggestedEmail) {
      lastAutoEmailRef.current = null;
      return;
    }

    const currentFirstEmail = emails[0]?.trim() || "";
    const shouldAutoUpdate =
      (!currentFirstEmail && lastAutoEmailRef.current === null) ||
      currentFirstEmail === lastAutoEmailRef.current;

    if (shouldAutoUpdate && currentFirstEmail !== suggestedEmail) {
      lastAutoEmailRef.current = suggestedEmail;
      const newEmails = [suggestedEmail, ...emails.slice(1)];
      setEmails(newEmails);
    }
  }, [suggestedEmail]);

  const handleToggle = (checked: boolean) => {
    setEnabled(checked);
    if (checked) {
      onChange({
        when,
        to: emails.filter((e) => e),
        ...(subject && { subject }),
        ...(htmlBody && { htmlBody }),
      });
    } else {
      onChange(undefined);
    }
  };

  const addEmail = () => {
    const newEmails = [...emails, ""];
    setEmails(newEmails);
    updateEmailOptions(newEmails);
  };

  const updateEmail = (index: number, value: string) => {
    const newEmails = [...emails];
    newEmails[index] = value;
    setEmails(newEmails);
    updateEmailOptions(newEmails);
  };

  const removeEmail = (index: number) => {
    const newEmails = emails.filter((_, i) => i !== index);
    setEmails(newEmails);
    updateEmailOptions(newEmails);
  };

  const updateEmailOptions = (emailList?: string[]) => {
    if (enabled) {
      onChange({
        when,
        to: (emailList || emails).filter((e) => e),
        ...(subject && { subject }),
        ...(htmlBody && { htmlBody }),
      });
    }
  };

  const handleWhenChange = (newWhen: "always" | "on_peppol_failure") => {
    setWhen(newWhen);
    if (enabled) {
      onChange({
        when: newWhen,
        to: emails.filter((e) => e),
        ...(subject && { subject }),
        ...(htmlBody && { htmlBody }),
      });
    }
  };

  const handleSubjectChange = (newSubject: string) => {
    setSubject(newSubject);
    if (enabled) {
      onChange({
        when,
        to: emails.filter((e) => e),
        ...(newSubject && { subject: newSubject }),
        ...(htmlBody && { htmlBody }),
      });
    }
  };

  const handleBodyChange = (newBody: string) => {
    setHtmlBody(newBody);
    if (enabled) {
      onChange({
        when,
        to: emails.filter((e) => e),
        ...(subject && { subject }),
        ...(newBody && { htmlBody: newBody }),
      });
    }
  };

  return (
    <Card className="p-4">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Mail className="h-4 w-4" />
            <Label htmlFor="email-enabled">{t`Send via Email`}</Label>
          </div>
          <Switch
            id="email-enabled"
            checked={enabled}
            onCheckedChange={handleToggle}
          />
        </div>

        {enabled && (
          <Collapsible open={isOpen} onOpenChange={setIsOpen}>
            <div className="space-y-4">
              <div>
                <Label htmlFor="when">{t`When to send email`}</Label>
                <Select value={when} onValueChange={handleWhenChange}>
                  <SelectTrigger id="when">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="on_peppol_failure">
                      {t`Only if Peppol fails`}
                    </SelectItem>
                    <SelectItem value="always">
                      {t`Always (in addition to Peppol)`}
                    </SelectItem>
                  </SelectContent>
                </Select>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t`If no Peppol recipient is provided, email will be the primary delivery method regardless of this setting.`}
                </p>
              </div>

              <div>
                <Label>{t`Email Recipients`}</Label>
                <div className="space-y-2">
                  {emails.map((email, index) => (
                    <div key={index} className="flex gap-2">
                      <Input
                        type="email"
                        value={email}
                        onChange={(e) => updateEmail(index, e.target.value)}
                        placeholder="recipient@example.com"
                        required
                      />
                      {emails.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost-destructive"
                          size="icon"
                          onClick={() => removeEmail(index)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addEmail}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    {t`Add Recipient`}
                  </Button>
                </div>
              </div>

              <CollapsibleTrigger className="flex w-full items-center justify-between py-2 text-sm font-medium">
                <span>{t`Custom Email Content (Optional)`}</span>
                <ChevronDown
                  className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`}
                />
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-4">
                <div>
                  <Label htmlFor="subject">{t`Email Subject`}</Label>
                  <Input
                    id="subject"
                    value={subject}
                    onChange={(e) => handleSubjectChange(e.target.value)}
                    placeholder={t`Default: Invoice {number} or Credit Note {number}`}
                  />
                </div>

                <div>
                  <Label htmlFor="htmlBody">{t`Email Body (HTML)`}</Label>
                  <Textarea
                    id="htmlBody"
                    value={htmlBody}
                    onChange={(e) => handleBodyChange(e.target.value)}
                    placeholder={t`Default: Dear {buyer name}, you can find your invoice attached.`}
                    rows={4}
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t`You can use HTML tags for formatting. The document will be attached as XML, plus any embedded attachments (optionally including a generated PDF).`}
                  </p>
                </div>
              </CollapsibleContent>
            </div>
          </Collapsible>
        )}
      </div>
    </Card>
  );
}
