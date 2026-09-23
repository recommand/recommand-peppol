import "zod-openapi/extend";
import { Server } from "@recommand/lib/api";
import getLabelsServer, { type GetLabels } from "./get-labels";
import getLabelServer, { type GetLabel } from "./get-label";
import createLabelServer, { type CreateLabel } from "./create-label";
import updateLabelServer, { type UpdateLabel } from "./update-label";
import deleteLabelServer, { type DeleteLabel } from "./delete-label";

export type Labels = GetLabels | GetLabel | CreateLabel | UpdateLabel | DeleteLabel;

const server = new Server();
server.route("/", getLabelsServer);
server.route("/", getLabelServer);
server.route("/", createLabelServer);
server.route("/", updateLabelServer);
server.route("/", deleteLabelServer);
export default server;

