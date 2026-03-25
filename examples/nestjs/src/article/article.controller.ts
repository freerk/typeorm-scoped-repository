import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Headers,
  BadRequestException,
} from '@nestjs/common';
import { Scope } from 'typeorm-scoped-repository';
import { ArticleService } from './article.service';

@Controller('articles')
export class ArticleController {
  constructor(private readonly articleService: ArticleService) {}

  @Get()
  findAll(@Headers('x-organisation-id') organisationId: string) {
    return this.articleService.findAll(this.buildScope(organisationId));
  }

  @Get(':id')
  findOne(
    @Headers('x-organisation-id') organisationId: string,
    @Param('id') id: string,
  ) {
    return this.articleService.findOne(this.buildScope(organisationId), id);
  }

  @Post()
  create(
    @Headers('x-organisation-id') organisationId: string,
    @Body() body: { title: string; body: string },
  ) {
    return this.articleService.create(this.buildScope(organisationId), body);
  }

  @Delete(':id')
  remove(
    @Headers('x-organisation-id') organisationId: string,
    @Param('id') id: string,
  ) {
    return this.articleService.remove(this.buildScope(organisationId), id);
  }

  private buildScope(organisationId: string): Scope {
    if (!organisationId) {
      throw new BadRequestException('x-organisation-id header is required');
    }
    return { organisationId };
  }
}
