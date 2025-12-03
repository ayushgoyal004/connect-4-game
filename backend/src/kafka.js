const {Kafka}=require('kafkajs');

class KafkaWrapper{
  constructor(){
    const brokers=(process.env.KAFKA_BROKERS || '').split(',').filter(Boolean);
    if (!brokers.length) {
      this.enabled=false;
      console.log('Kafka disabled (KAFKA_BROKERS not set). Events will be no-ops.');
      return;
    }
    this.enabled=true;
    this.kafka=new Kafka({ clientId:'connect4',brokers});
    this.producer=this.kafka.producer();
    this.producer.connect().then(()=>console.log('Kafka producer connected')).catch(err=>{console.error('kafka connect err',err);this.enabled=false;});
  }
  async emit(topic,evt) {
    if (!this.enabled) return;
    try {
      await this.producer.send({ topic:'game-events',messages:[{value:JSON.stringify({topic, ...evt })}]});
    } catch(err) {
      console.error('kafka send error',err);
    }
  }
}
module.exports = KafkaWrapper;