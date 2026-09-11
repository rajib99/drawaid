import { NextFunction, Response } from "express";
import { prisma } from "../db";
import { hashApiKey } from "../services/apiKey";
import { AuthenticatedRequest } from "../types";

export async function apiKeyAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const apiKey = req.header("X-API-Key");
  if (!apiKey) {
    return res.status(401).json({ error: "Missing X-API-Key header" });
  }
  const business = await prisma.business.findUnique({
    where: { apiKeyHash: hashApiKey(apiKey) },
  });
  if (!business) {
    return res.status(401).json({ error: "Invalid API key" });
  }
  req.business = business;
  next();
}
