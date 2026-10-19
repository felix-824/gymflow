import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import MemberSchema from '../../schemas/Member.model';
import TrainerApplicationSchema from '../../schemas/TrainerApplication.model';
import { AuthModule } from '../auth/auth.module';
import { TrainerApplicationResolver } from './trainer-application.resolver';
import { TrainerApplicationService } from './trainer-application.service';

@Module({
	imports: [
		MongooseModule.forFeature([
			{ name: 'TrainerApplication', schema: TrainerApplicationSchema },
			{ name: 'Member', schema: MemberSchema },
		]),
		AuthModule,
	],
	providers: [TrainerApplicationResolver, TrainerApplicationService],
})
export class TrainerApplicationModule {}
