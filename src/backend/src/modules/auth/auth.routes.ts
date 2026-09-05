import { Router, Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { loadConfig } from "../../config.js";
import { query } from "../../database/pool.js";
import { UnauthorizedError } from "../../shared/errors.js";
import { authenticate } from "../../middleware/auth.js";

export const authRouter = Router();

authRouter.post("/login", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      throw new UnauthorizedError("Email and password are required");
    }

    const result = await query(
      `SELECT u.id, u.email, u.password_hash, u.role_id, r.name as role_name
       FROM users u
       JOIN roles r ON u.role_id = r.id
       WHERE u.email = $1 AND u.is_active = true`,
      [email.toLowerCase()]
    );

    if (result.rows.length === 0) {
      throw new UnauthorizedError("Invalid credentials");
    }

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      throw new UnauthorizedError("Invalid credentials");
    }

    const config = loadConfig();
    const tokenPayload = { userId: user.id, roleId: user.role_id, email: user.email };
    const accessToken = jwt.sign(tokenPayload, config.JWT_SECRET, {
      expiresIn: config.JWT_EXPIRES_IN as any,
    });
    const refreshToken = jwt.sign(tokenPayload, config.JWT_SECRET, {
      expiresIn: config.JWT_REFRESH_EXPIRES_IN as any,
    });

    res.json({
      data: {
        access_token: accessToken,
        refresh_token: refreshToken,
        user: { id: user.id, email: user.email, role_id: user.role_id, role_name: user.role_name },
      },
    });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/refresh", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { refresh_token } = req.body;
    if (!refresh_token) {
      throw new UnauthorizedError("Refresh token required");
    }

    const config = loadConfig();
    let payload;
    try {
      payload = jwt.verify(refresh_token, config.JWT_SECRET) as { userId: number; roleId: number; email: string };
    } catch {
      throw new UnauthorizedError("Invalid or expired refresh token");
    }

    const accessToken = jwt.sign(
      { userId: payload.userId, roleId: payload.roleId, email: payload.email },
      config.JWT_SECRET,
      { expiresIn: config.JWT_EXPIRES_IN as any }
    );
    const newRefreshToken = jwt.sign(
      { userId: payload.userId, roleId: payload.roleId, email: payload.email },
      config.JWT_SECRET,
      { expiresIn: config.JWT_REFRESH_EXPIRES_IN as any }
    );

    res.json({
      data: { access_token: accessToken, refresh_token: newRefreshToken },
    });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/logout", authenticate, (_req: Request, res: Response) => {
  res.json({ data: { message: "Logged out" } });
});
