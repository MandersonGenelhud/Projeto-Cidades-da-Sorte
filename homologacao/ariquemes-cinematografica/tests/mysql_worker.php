<?php
declare(strict_types=1);
require __DIR__.'/../mysql/Settings.php';require __DIR__.'/../src/Prelaunch.php';
try{
 $db=connectMysqlHomologation();
 $result=registerPrelaunch($db,['name'=>'Pessoa Fictícia Concorrente','phone'=>$argv[1]??'','consent_test'=>true,'companies'=>['Empresa Fictícia']],'test','test',$argv[2]??'',1000);
 echo json_encode($result,JSON_THROW_ON_ERROR|JSON_UNESCAPED_UNICODE);
}catch(Throwable $e){fwrite(STDERR,"Worker MySQL de teste indisponível.\n");exit(1);}
