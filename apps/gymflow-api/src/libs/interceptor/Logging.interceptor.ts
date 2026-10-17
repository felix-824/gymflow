import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { GqlContextType, GqlExecutionContext } from '@nestjs/graphql';
import { Observable } from 'rxjs';
import { finalize } from 'rxjs/operators';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
	private readonly logger = new Logger();
	public intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
		if (context.getType<GqlContextType>() !== 'graphql') return next.handle();
		const started = Date.now();
		const operation = GqlExecutionContext.create(context).getInfo<{ fieldName: string }>().fieldName;
		return next.handle().pipe(
			finalize(() => {
				this.logger.log({ operation, durationMs: Date.now() - started });
			}),
		);
	}
}
