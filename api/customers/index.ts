import "zod-openapi/extend";
import { Server } from "@recommand/lib/api";
import listCustomersServer, { type ListCustomers } from "./list-customers";
import getCustomerServer, { type GetCustomer } from "./get-customer";
import upsertCustomerServer, { type UpsertCustomer } from "./upsert-customer";
import deleteCustomerServer, { type DeleteCustomer } from "./delete-customer";

export type Customers =
  | ListCustomers
  | GetCustomer
  | UpsertCustomer
  | DeleteCustomer;

const server = new Server();
server.route("/", listCustomersServer);
server.route("/", getCustomerServer);
server.route("/", upsertCustomerServer);
server.route("/", deleteCustomerServer);
export default server;
