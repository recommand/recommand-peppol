import { useState, useEffect } from "react";
import { Button } from "@core/components/ui/button";
import { Input } from "@core/components/ui/input";
import { Label } from "@core/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@core/components/ui/card";
import { AsyncButton } from "@core/components/async-button";
import { toast } from "@core/components/ui/sonner";
import { Plus, Edit, Trash2, X, Check } from "lucide-react";
import { rc } from "@recommand/lib/client";
import type { CompanyIdentifiers } from "@peppol/api/companies/identifiers";
import type { CompanyIdentifier } from "@peppol/data/company-identifiers";
import { stringifyActionFailure } from "@recommand/lib/utils";

const client = rc<CompanyIdentifiers>("peppol");

type CompanyIdentifiersManagerProps = {
    teamId: string;
    companyId: string;
};

type IdentifierFormData = {
    scheme: string;
    identifier: string;
};

export function CompanyIdentifiersManager({ teamId, companyId }: CompanyIdentifiersManagerProps) {
    const [identifiers, setIdentifiers] = useState<CompanyIdentifier[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isAdding, setIsAdding] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [formData, setFormData] = useState<IdentifierFormData>({ scheme: "", identifier: "" });
    const [editFormData, setEditFormData] = useState<IdentifierFormData>({ scheme: "", identifier: "" });

    useEffect(() => {
        fetchIdentifiers();
    }, [teamId, companyId]);

    const fetchIdentifiers = async () => {
        try {
            setIsLoading(true);
            const response = await client[":teamId"]["companies"][":companyId"]["identifiers"].$get({
                param: { teamId, companyId },
            });
            const json = await response.json();

            if (!json.success) {
                toast.error(stringifyActionFailure(json.errors));
                return;
            }

            setIdentifiers((json.identifiers || []).map(id => ({
                ...id,
                createdAt: new Date(id.createdAt),
                updatedAt: new Date(id.updatedAt),
            })));
        } catch (error) {
            console.error("Error fetching identifiers:", error);
            toast.error("Failed to load company identifiers: " + error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleAdd = async () => {
        if (!formData.scheme.trim()) {
            toast.error("Scheme is required");
            return;
        }
        if (!formData.identifier.trim()) {
            toast.error("Identifier is required");
            return;
        }

        try {
            setIsSubmitting(true);
            const response = await client[":teamId"]["companies"][":companyId"]["identifiers"].$post({
                param: { teamId, companyId },
                json: formData,
            });

            const json = await response.json();
            if (!json.success) {
                throw new Error(stringifyActionFailure(json.errors));
            }

            toast.success("Identifier added successfully");
            setFormData({ scheme: "", identifier: "" });
            setIsAdding(false);
        } catch (error) {
            toast.error("Failed to add identifier: " + error);
        } finally {
            setIsSubmitting(false);
            fetchIdentifiers();
        }
    };

    const handleEdit = async () => {
        if (!editingId) {
            toast.error("No identifier selected for editing");
            return;
        }
        if (!editFormData.scheme.trim()) {
            toast.error("Scheme is required");
            return;
        }
        if (!editFormData.identifier.trim()) {
            toast.error("Identifier is required");
            return;
        }

        try {
            setIsSubmitting(true);
            const response = await client[":teamId"]["companies"][":companyId"]["identifiers"][":identifierId"].$put({
                param: { teamId, companyId, identifierId: editingId },
                json: editFormData,
            });

            const json = await response.json();
            if (!json.success) {
                throw new Error(stringifyActionFailure(json.errors));
            }

            toast.success("Identifier updated successfully");
            setEditingId(null);
            setEditFormData({ scheme: "", identifier: "" });
        } catch (error) {
            toast.error("Failed to update identifier: " + error);
        } finally {
            setIsSubmitting(false);
            fetchIdentifiers();
        }
    };

    const handleDelete = async (identifierId: string) => {
        try {
            const response = await client[":teamId"]["companies"][":companyId"]["identifiers"][":identifierId"].$delete({
                param: { teamId, companyId, identifierId },
            });

            const json = await response.json();
            if (!json.success) {
                throw new Error(stringifyActionFailure(json.errors));
            }

            toast.success("Identifier deleted successfully");
        } catch (error) {
            toast.error("Failed to delete identifier: " + error);
        } finally {
            fetchIdentifiers();
        }
    };

    const startEdit = (identifier: CompanyIdentifier) => {
        setEditingId(identifier.id);
        setEditFormData({
            scheme: identifier.scheme,
            identifier: identifier.identifier,
        });
    };

    const cancelEdit = () => {
        setEditingId(null);
        setEditFormData({ scheme: "", identifier: "" });
    };

    const cancelAdd = () => {
        setIsAdding(false);
        setFormData({ scheme: "", identifier: "" });
    };

    if (isLoading) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>Company Identifiers</CardTitle>
                    <CardDescription>Manage your company identifiers</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex items-center justify-center h-32">
                        <div className="text-center text-muted-foreground">Loading...</div>
                    </div>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card>
            <CardHeader>
                <div className="flex items-center justify-between gap-4">
                    <div>
                        <CardTitle>Company Identifiers</CardTitle>
                        <CardDescription className="text-balance">
                            Identifiers are used to identify your company in the Peppol network.
                        </CardDescription>
                    </div>
                    {!isAdding && (
                        <Button onClick={() => setIsAdding(true)} size="sm">
                            <Plus className="h-4 w-4" />
                            Add Identifier
                        </Button>
                    )}
                </div>
            </CardHeader>
            <CardContent className="space-y-4">
                {/* Add Form */}
                {isAdding && (
                    <div className="p-4 border rounded-lg bg-muted/50">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="add-scheme">Scheme</Label>
                                <Input
                                    id="add-scheme"
                                    placeholder="e.g., 0208 (Belgium)"
                                    value={formData.scheme}
                                    onChange={(e) => setFormData({ ...formData, scheme: e.target.value })}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="add-identifier">Identifier</Label>
                                <Input
                                    id="add-identifier"
                                    placeholder="e.g., 1012081766"
                                    value={formData.identifier}
                                    onChange={(e) => setFormData({ ...formData, identifier: e.target.value })}
                                />
                            </div>
                        </div>

                        <p className="text-xs text-muted-foreground mt-2">
                            Common schemes: 0208 (Belgium), 0106 (Netherlands), 0225 (France)
                        </p>
                        <div className="flex gap-2 mt-4 justify-end">
                            <AsyncButton onClick={handleAdd} size="sm" disabled={isSubmitting}>
                                <Check className="h-4 w-4" />
                                Add
                            </AsyncButton>
                            <Button onClick={cancelAdd} variant="outline" size="sm" disabled={isSubmitting}>
                                <X className="h-4 w-4" />
                                Cancel
                            </Button>
                        </div>
                    </div>
                )}

                {/* Identifiers List */}
                <div className="space-y-2">
                    {identifiers.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">
                            <p>No identifiers found</p>
                            <p className="text-sm">Add your first identifier to get started</p>
                        </div>
                    ) : (
                        identifiers.map((identifier) => (
                            <div key={identifier.id} className="flex items-center justify-between p-3 border rounded-lg gap-4">
                                {editingId === identifier.id ? (
                                    // Edit Form
                                    <div className="flex-1 space-y-4">
                                        <div className="grid grid-cols-2 gap-2">
                                            <div className="space-y-1">
                                                <Label htmlFor={`edit-scheme-${identifier.id}`} className="text-xs">Scheme</Label>
                                                <Input
                                                    id={`edit-scheme-${identifier.id}`}
                                                    value={editFormData.scheme}
                                                    onChange={(e) => setEditFormData({ ...editFormData, scheme: e.target.value })}
                                                    size={1}
                                                />
                                            </div>
                                            <div className="space-y-1">
                                                <Label htmlFor={`edit-identifier-${identifier.id}`} className="text-xs">Identifier</Label>
                                                <Input
                                                    id={`edit-identifier-${identifier.id}`}
                                                    value={editFormData.identifier}
                                                    onChange={(e) => setEditFormData({ ...editFormData, identifier: e.target.value })}
                                                    size={1}
                                                />
                                            </div>
                                        </div>
                                        <div className="flex gap-2 justify-end">
                                            <AsyncButton onClick={handleEdit} size="sm" variant="default" disabled={isSubmitting}>
                                                <Check className="h-4 w-4" />
                                                Save Changes
                                            </AsyncButton>
                                            <Button onClick={cancelEdit} size="sm" variant="outline" disabled={isSubmitting}>
                                                <X className="h-4 w-4" />
                                                Cancel Edit
                                            </Button>
                                        </div>
                                    </div>
                                ) : (
                                    // Display
                                    <div className="flex-1">
                                        <div className="font-medium">{identifier.scheme}:{identifier.identifier}</div>
                                        <div className="text-xs text-muted-foreground">
                                            Updated: {new Date(identifier.updatedAt).toLocaleDateString()}
                                        </div>
                                    </div>
                                )}

                                {editingId === identifier.id ? null : (
                                    <div className="flex gap-2">
                                        <Button
                                            onClick={() => startEdit(identifier)}
                                            size="sm"
                                            variant="outline"
                                        >
                                            <Edit className="h-4 w-4" />
                                        </Button>
                                        <AsyncButton
                                            onClick={() => handleDelete(identifier.id)}
                                            size="sm"
                                            variant="destructive"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </AsyncButton>
                                    </div>
                                )}
                            </div>
                        ))
                    )}
                </div>
            </CardContent>
        </Card>
    );
}
