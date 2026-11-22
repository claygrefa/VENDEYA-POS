// ============================================================
// src/server/services/container.factory.ts — Composición de dependencias
// ============================================================
import type { PrismaClient } from "@prisma/client";
import { ClienteRepository } from "../repositories/cliente.repository";
import { EmpresaRepository } from "../repositories/empresa.repository";
import { ProductoRepository } from "../repositories/producto.repository";
import { UsuarioRepository } from "../repositories/usuario.repository";
import { ClienteService } from "./cliente.service";
import { EmpresaService } from "./empresa.service";
import { ProductoService } from "./producto.service";
import { SessionService } from "./session.service";
import { UsuarioService } from "./usuario.service";

export interface Servicios {
  prisma: PrismaClient;
  empresas: EmpresaService;
  usuarios: UsuarioService;
  productos: ProductoService;
  clientes: ClienteService;
  sesiones: SessionService;
}

export function crearServicios(prisma: PrismaClient, sesiones: SessionService = new SessionService()): Servicios {
  return {
    prisma,
    empresas: new EmpresaService(new EmpresaRepository(prisma)),
    usuarios: new UsuarioService(new UsuarioRepository(prisma)),
    productos: new ProductoService(new ProductoRepository(prisma)),
    clientes: new ClienteService(new ClienteRepository(prisma)),
    sesiones,
  };
}
