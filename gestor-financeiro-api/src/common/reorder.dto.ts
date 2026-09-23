import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from 'class-validator';

// Nova ordem de uma lista (contas, cartões ou categorias irmãs): os ids na
// ordem desejada. Ver common/ordering.ts.
export class ReorderDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  ids: string[];
}
