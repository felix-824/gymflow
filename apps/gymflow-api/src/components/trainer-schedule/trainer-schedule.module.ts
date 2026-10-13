import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import TrainerScheduleSchema from '../../schemas/TrainerSchedule.model';
import { AuthModule } from '../auth/auth.module';
import { TrainerScheduleResolver } from './trainer-schedule.resolver';
import { TrainerScheduleService } from './trainer-schedule.service';

@Module({
	imports: [MongooseModule.forFeature([{ name: 'TrainerSchedule', schema: TrainerScheduleSchema }]), AuthModule],
	providers: [TrainerScheduleResolver, TrainerScheduleService],
	exports: [TrainerScheduleService],
})
export class TrainerScheduleModule {}
