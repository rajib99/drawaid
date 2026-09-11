import { NextFunction, Request, Response } from "express";
import { config } from "../config";

export function adminAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.header("X-Admin-Token");
  if (!token || token !== config.adminToken) {
    return res.status(401).json({ error: "Invalid or missing X-Admin-Token" });
  }
  next();
}
