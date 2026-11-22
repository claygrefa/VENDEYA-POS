// ============================================================
// src/server/services/container.factory.ts — Composición de dependencias
// ============================================================
import type { PrismaClient } from "@prisma/client";
import { ClienteRepository } from "../repositories/cliente.repository";
import { EmpresaRepository } from "../repositories/empresa.repository";
import { KardexRepository } from "../repositories/kardex.repository";
import { ProductoRepository } from "../repositories/producto.repository";
import { UsuarioRepository } from "../repositories/usuario.repository";
import { VentaRepository } from "../repositories/venta.repository";
import { ClienteService } from "./cliente.service";
import { EmpresaService } from "./empresa.service";
import { KardexService } from "./kardex.service";
import { ProductoService } from "./producto.service";
import { SessionService } from "./session.service";
import { UsuarioService } from "./usuario.service";
import { VentaService } from "./venta.service";

export interface Servicios {
  prisma: PrismaClient;
  empresas: EmpresaService;
  usuarios: UsuarioService;
  productos: ProductoService;
  clientes: ClienteService;
  kardex: KardexService;
  ventas: VentaService;
  sesiones: SessionService;
}

export function crearServicios(prisma: PrismaClient, sesiones: SessionService = new SessionService()): Servicios {
  const kardex = new KardexService(new KardexRepository());
  return {
    prisma,
    empresas: new EmpresaService(new EmpresaRepository(prisma)),
    usuarios: new UsuarioService(new UsuarioRepository(prisma)),
    productos: new ProductoService(new ProductoRepository(prisma)),
    clientes: new ClienteService(new ClienteRepository(prisma)),
    kardex,
    ventas: new VentaService(prisma, new VentaRepository(), kardex),
    sesiones,
  };
}
