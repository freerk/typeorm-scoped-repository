import { Repository, ObjectLiteral } from 'typeorm';
import {
  ScopedRepositoryModule,
  ScopedRepositoryFactory,
  getScopedFactoryToken,
  InjectScopedFactory,
} from './nestjs';
import { ScopedRepository } from './scoped-repository';

class FakeEntity {
  id!: string;
  organisationId!: string;
  name!: string;
}

class AnotherEntity {
  id!: string;
  accountId!: string;
}

describe('getScopedFactoryToken', () => {
  it('generates a unique token per entity', () => {
    expect(getScopedFactoryToken(FakeEntity)).toBe(
      'ScopedRepositoryFactory<FakeEntity>',
    );
    expect(getScopedFactoryToken(AnotherEntity)).toBe(
      'ScopedRepositoryFactory<AnotherEntity>',
    );
  });

  it('generates different tokens for different entities', () => {
    expect(getScopedFactoryToken(FakeEntity)).not.toBe(
      getScopedFactoryToken(AnotherEntity),
    );
  });
});

describe('InjectScopedFactory', () => {
  it('returns a ParameterDecorator', () => {
    const decorator = InjectScopedFactory(FakeEntity);
    expect(typeof decorator).toBe('function');
  });
});

describe('ScopedRepositoryModule.forFeature', () => {
  it('returns a DynamicModule with providers for each entity', () => {
    const dynamicModule = ScopedRepositoryModule.forFeature([
      FakeEntity,
      AnotherEntity,
    ]);

    expect(dynamicModule.module).toBe(ScopedRepositoryModule);
    expect(dynamicModule.providers).toHaveLength(2);
    expect(dynamicModule.exports).toEqual([
      'ScopedRepositoryFactory<FakeEntity>',
      'ScopedRepositoryFactory<AnotherEntity>',
    ]);
  });

  it('imports TypeOrmModule.forFeature with the entities', () => {
    const dynamicModule = ScopedRepositoryModule.forFeature([FakeEntity]);

    // TypeOrmModule.forFeature returns a DynamicModule
    expect(dynamicModule.imports).toHaveLength(1);
  });

  it('provider factory creates a working ScopedRepositoryFactory', () => {
    const dynamicModule = ScopedRepositoryModule.forFeature([FakeEntity]);

    // Extract the provider and call its factory manually
    const provider = (dynamicModule.providers as any[])[0];
    expect(provider.provide).toBe('ScopedRepositoryFactory<FakeEntity>');

    // Simulate what NestJS DI does: call useFactory with a mock repo
    const mockRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
      increment: jest.fn(),
      createQueryBuilder: jest.fn(),
      target: FakeEntity,
    } as unknown as Repository<ObjectLiteral>;

    const factory: ScopedRepositoryFactory<ObjectLiteral> =
      provider.useFactory(mockRepo);

    expect(typeof factory).toBe('function');

    // Call the factory with a scope
    const scoped = factory({ organisationId: 'org-123' });
    expect(scoped).toBeInstanceOf(ScopedRepository);
    expect(scoped.getScope()).toEqual({ organisationId: 'org-123' });
  });

  it('factory creates independent ScopedRepository per call', () => {
    const dynamicModule = ScopedRepositoryModule.forFeature([FakeEntity]);
    const provider = (dynamicModule.providers as any[])[0];

    const mockRepo = {
      find: jest.fn().mockResolvedValue([]),
      target: FakeEntity,
    } as unknown as Repository<ObjectLiteral>;

    const factory: ScopedRepositoryFactory<ObjectLiteral> =
      provider.useFactory(mockRepo);

    const scoped1 = factory({ organisationId: 'org-1' });
    const scoped2 = factory({ organisationId: 'org-2' });
    const scopedComposite = factory({
      accountId: 'default',
      ownerSpace: 'abc',
    });

    expect(scoped1.getScope()).toEqual({ organisationId: 'org-1' });
    expect(scoped2.getScope()).toEqual({ organisationId: 'org-2' });
    expect(scopedComposite.getScope()).toEqual({
      accountId: 'default',
      ownerSpace: 'abc',
    });
  });
});
