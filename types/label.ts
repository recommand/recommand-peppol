import { FOLDER } from "@core/lib/config/colors";

export type Label = {
  id: string;
  teamId: string;
  externalId: string | null;
  name: string;
  colorHex: string;
  createdAt: string;
  updatedAt: string;
};

export type LabelFormData = Omit<Label, 'id' | 'teamId' | 'createdAt' | 'updatedAt'>;

export const defaultLabelFormData: LabelFormData = {
  name: "",
  colorHex: FOLDER,
  externalId: null,
};

