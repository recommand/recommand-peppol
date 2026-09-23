import "zod-openapi/extend";
import { Server } from "@recommand/lib/api";
import getIdentifiersServer, { type GetIdentifiers } from "./get-identifiers";
import getIdentifierServer, { type GetIdentifier } from "./get-identifier";
import getIdentifierSchemesServer, { type GetIdentifierSchemes } from "./get-identifier-schemes";
import createIdentifierServer, { type CreateIdentifier } from "./create-identifier";
import updateIdentifierServer, { type UpdateIdentifier } from "./update-identifier";
import deleteIdentifierServer, { type DeleteIdentifier } from "./delete-identifier";
import requestMigrationServer, { type RequestIdentifierMigration } from "./request-migration";
import getMigrationsServer, { type GetIdentifierMigrations } from "./get-migrations";

export type CompanyIdentifiers = GetIdentifiers | GetIdentifierSchemes | GetIdentifier | CreateIdentifier | UpdateIdentifier | DeleteIdentifier | RequestIdentifierMigration | GetIdentifierMigrations;

const server = new Server();
server.route("/", getIdentifiersServer);
server.route("/", getIdentifierSchemesServer);
server.route("/", getIdentifierServer);
server.route("/", createIdentifierServer);
server.route("/", updateIdentifierServer);
server.route("/", deleteIdentifierServer);
server.route("/", requestMigrationServer);
server.route("/", getMigrationsServer);
export default server;