screenLock();

window.onload = function() {
   delete_dom_obj('screenLock');
}

function screenLock(){
    // ロック用のdivを生成
    var element = document.createElement('div');
    element.id = "screenLock";
    // ロック用のスタイル
    element.style.height = '100%';
    element.style.left = '0px';
    element.style.position = 'fixed';
    element.style.top = '0px';
    element.style.width = '100%';
    element.style.zIndex = '9999';
    element.style.opacity = '0.5';
    element.style.backgroundColor = '#000000';
    element.style.backgroundImage='url("img-loading.gif")';
    element.style.backgroundRepeat = 'no-repeat';
    element.style.backgroundPosition = 'center center';

    var objBody = document.getElementsByTagName("body").item(0);
    objBody.appendChild(element);
}

// div削除関数
function delete_dom_obj( id_name ){
    var dom_obj = document.getElementById(id_name);
    var dom_obj_parent=dom_obj.parentNode;
    dom_obj_parent.removeChild(dom_obj);
}
