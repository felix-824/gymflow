import { Module } from '@nestjs/common';
import { ProgramResolver } from './program.resolver';
import { ProgramService } from './program.service';
import { MongooseModule } from '@nestjs/mongoose';
import NotificationSchema from '../../schemas/Notification.model';
import ProgramSchema from '../../schemas/Program.model';
import { AuthModule } from '../auth/auth.module';
import { ViewModule } from '../view/view.module';
import { MemberModule } from '../member/member.module';
import { LikeModule } from '../like/like.module';

@Module({
	imports: [
		MongooseModule.forFeature([
			{
				name: 'Program',
				schema: ProgramSchema,
			},
			{ name: 'Notification', schema: NotificationSchema },
		]),
		AuthModule,
		ViewModule,
		MemberModule,
		LikeModule,
	],
	providers: [ProgramResolver, ProgramService],
	exports: [ProgramService],
})
export class ProgramModule {}
