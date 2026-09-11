import { Request } from "express";
import { Business } from "@prisma/client";

export interface AuthenticatedRequest extends Request {
  business?: Business;
}
