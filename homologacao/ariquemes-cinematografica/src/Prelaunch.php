<?php
declare(strict_types=1);
/** Homologação somente. Nenhum envio/OTP, pagamento ou consulta a produção. */
function registerPrelaunch(PDO $db,array $input,string $sessionToken,string $requestToken,string $clientHash,int $now):array {
    $accepted=['status'=>202,'body'=>['message'=>'Solicitação de teste recebida. Nenhum dado de cadastro é exibido e nenhuma mensagem será enviada.']];
    $unavailable=['status'=>503,'body'=>['message'=>'Não foi possível concluir o teste. Tente novamente em instantes.']];
    if($sessionToken==='' || !hash_equals($sessionToken,$requestToken))return ['status'=>403,'body'=>['message'=>'Sessão de teste expirada. Recarregue a página.']];
    // Limite por cliente é fornecido pelo servidor, nunca pelo corpo da requisição.
    if($clientHash==='')return $unavailable;
    $name=is_string($input['name']??null)?trim($input['name']):'';
    $phone=is_string($input['phone']??null)?preg_replace('/\D/','',$input['phone']):'';
    if(in_array(strlen($phone),[12,13],true)&&str_starts_with($phone,'55'))$phone=substr($phone,2);
    $email=is_string($input['email']??null)?trim($input['email']):'';
    $companies=$input['companies']??[];
    $errors=[];
    if(mb_strlen($name)<3 || mb_strlen($name)>190 || preg_match('/[\x00-\x1f]/',$name))$errors['name']='Informe um nome fictício de 3 a 190 caracteres.';
    if(!preg_match('/^[1-9][0-9][0-9]{8,9}$/',$phone))$errors['phone']='Confira o telefone fictício com DDD.';
    if(strlen($email)>190 || ($email!==''&&!filter_var($email,FILTER_VALIDATE_EMAIL)))$errors['email']='Confira o e-mail fictício.';
    if(($input['consent_test']??false)!==true)$errors['consent_test']='Confirme que está usando somente dados fictícios.';
    if(!is_array($companies)||count($companies)>3)$errors['companies']='Informe até três empresas fictícias.';
    else foreach($companies as $company)if(!is_string($company)||mb_strlen($company)>190){$errors['companies']='Confira os nomes das empresas fictícias.';break;}
    if($errors)return ['status'=>422,'body'=>['message'=>'Revise os campos indicados.','errors'=>$errors]];
    try {
        $bucket=intdiv($now,900);
        $q=$db->prepare('UPDATE prelaunch_rate_limits SET attempts=attempts+1 WHERE client_hash=? AND bucket=?');$q->execute([$clientHash,$bucket]);
        if($q->rowCount()===0){
            try{$q=$db->prepare('INSERT INTO prelaunch_rate_limits(client_hash,bucket,attempts) VALUES(?,?,1)');$q->execute([$clientHash,$bucket]);}
            catch(PDOException $e){if($e->getCode()!=='23000')throw $e;$q=$db->prepare('UPDATE prelaunch_rate_limits SET attempts=attempts+1 WHERE client_hash=? AND bucket=?');$q->execute([$clientHash,$bucket]);}
        }
        $q=$db->prepare('SELECT attempts FROM prelaunch_rate_limits WHERE client_hash=? AND bucket=?');$q->execute([$clientHash,$bucket]);
        if((int)$q->fetchColumn()>5)return ['status'=>429,'body'=>['message'=>'Limite de testes atingido. Aguarde a próxima janela de 15 minutos.']];
        $db->beginTransaction();
        $q=$db->prepare('SELECT id FROM prelaunch_leads WHERE phone=?');$q->execute([$phone]);
        if($q->fetchColumn()!==false){$db->commit();return $accepted;}
        // UPDATE adquire lock da linha dentro da transação, em vez de MAX()+1.
        $q=$db->prepare('UPDATE prelaunch_sequences SET last_number=last_number+1 WHERE sequence_key=?');$q->execute(['founder']);
        if($q->rowCount()!==1)throw new RuntimeException('Sequence unavailable');
        $q=$db->prepare('SELECT last_number FROM prelaunch_sequences WHERE sequence_key=?');$q->execute(['founder']);$number=(int)$q->fetchColumn();
        $code=strtoupper(bin2hex(random_bytes(12)));
        $q=$db->prepare('INSERT INTO prelaunch_leads(founder_number,name,phone,email,referral_code,consent_whatsapp,consent_text,source) VALUES(?,?,?,?,?,0,?,?)');
        $q->execute([$number,$name,$phone,$email?:null,$code,'TESTE LOCAL: dados fictícios; sem autorização para mensagens.','homologacao']);
        $id=(int)$db->lastInsertId();
        $q=$db->prepare('INSERT INTO prelaunch_company_votes(lead_id,company_name,company_key) VALUES(?,?,?)');
        $seen=[];
        foreach($companies as $company){$company=trim($company);if($company==='')continue;$key=mb_strtolower(preg_replace('/\s+/u',' ',$company));if(isset($seen[$key]))continue;$seen[$key]=true;$q->execute([$id,$company,$key]);}
        $db->commit();return $accepted;
    }catch(Throwable $e){
        if($db->inTransaction())$db->rollBack();
        // Duplicata concorrente de telefone: resposta genérica idêntica; nenhuma edição.
        if($e instanceof PDOException && $e->getCode()==='23000'){
            try{$q=$db->prepare('SELECT id FROM prelaunch_leads WHERE phone=?');$q->execute([$phone]);if($q->fetchColumn()!==false)return $accepted;}catch(Throwable $ignored){}
        }
        return $unavailable;
    }
}
