import { Server } from "@recommand/lib/api";
import submitServer, {
  type SubmitFrenchB2BiReport,
  type SubmitFrenchB2CReport,
} from "./submit";
import declarantServer, {
  type GetFrenchReportingDeclarant,
  type RegisterFrenchReportingDeclarant,
} from "./declarant";

export type FrenchReporting =
  | SubmitFrenchB2CReport
  | SubmitFrenchB2BiReport
  | GetFrenchReportingDeclarant
  | RegisterFrenchReportingDeclarant;

const server = new Server();
server.route("/", declarantServer);
server.route("/", submitServer);
export default server;
