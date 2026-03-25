import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('articles')
export class ArticleEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  organisationId!: string;

  @Column()
  title!: string;

  @Column({ type: 'text' })
  body!: string;

  @Column({ type: 'datetime', default: () => "datetime('now')" })
  createdAt!: Date;
}
