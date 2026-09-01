/**
 * Ponto de entrada de efeito colateral da migração de storage.
 *
 * Existe separado de `storageMigration.ts` para que aquele módulo continue
 * importável pelos testes sem executar nada ao ser carregado. Aqui o import é
 * o próprio disparo, e é o primeiro do `main.tsx`.
 */
import { migrateLegacyStorageKeysOnce } from "./storageMigration";

migrateLegacyStorageKeysOnce();
