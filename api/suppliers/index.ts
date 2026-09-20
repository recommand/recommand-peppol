import "zod-openapi/extend";
import { Server } from "@recommand/lib/api";
import listSuppliersServer, { type ListSuppliers } from "./list-suppliers";
import getSupplierServer, { type GetSupplier } from "./get-supplier";
import assignLabelServer, { type AssignLabel } from "./assign-label";
import unassignLabelServer, { type UnassignLabel } from "./unassign-label";
import upsertSupplierServer, { type UpsertSupplier } from "./upsert-supplier";
import deleteSupplierServer, { type DeleteSupplier } from "./delete-supplier";

export type Suppliers = ListSuppliers | GetSupplier | AssignLabel | UnassignLabel | UpsertSupplier | DeleteSupplier;

const server = new Server();
server.route("/", listSuppliersServer);
server.route("/", getSupplierServer);
server.route("/", assignLabelServer);
server.route("/", unassignLabelServer);
server.route("/", upsertSupplierServer);
server.route("/", deleteSupplierServer);
export default server;

