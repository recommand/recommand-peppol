import { Server } from "@recommand/lib/api";
import createServer from "./create";
import deleteServer from "./delete";
import getServer from "./get";
import listServer from "./list";
import resultsServer from "./results";

const server = new Server();
server.route("/", createServer);
server.route("/", listServer);
server.route("/", getServer);
server.route("/", resultsServer);
server.route("/", deleteServer);

export default server;
