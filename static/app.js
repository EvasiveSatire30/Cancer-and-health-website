class Chatbox {
    constructor() {
        this.args = {
            openButtons: document.querySelectorAll('.chatbox__open'),
            chatBox: document.querySelector('.chatbox__support'),
            closeButton: document.querySelector('.chatbox__close'),
            sendButton: document.querySelector('.send__button'),
            navToggle: document.querySelector('.nav-toggle'),
            nav: document.querySelector('.site-nav')
        }

        this.state = false;
        this.messages = [];
    }

    display() {
        const {openButtons, chatBox, closeButton, sendButton, navToggle, nav} = this.args;

        openButtons.forEach(button => {
            button.addEventListener('click', () => this.toggleState(chatBox, button))
        });

        sendButton.addEventListener('click', () => this.onSendButton(chatBox))
        closeButton.addEventListener('click', () => this.setChatState(false, chatBox))

        const node = chatBox.querySelector('input');
        node.addEventListener("keydown", event => {
            if (event.isComposing) {
                return;
            }
            const {key} = event;
            if (key === "Enter") {
                event.preventDefault();
                this.onSendButton(chatBox)
            }
        });

        navToggle.addEventListener('click', () => {
            const isExpanded = navToggle.getAttribute('aria-expanded') === 'true';
            navToggle.setAttribute('aria-expanded', String(!isExpanded));
            navToggle.setAttribute('aria-label', isExpanded ? 'Open navigation' : 'Close navigation');
            nav.classList.toggle('is-open', !isExpanded);
        });

        nav.querySelectorAll('a').forEach(link => {
            link.addEventListener('click', () => {
                nav.classList.remove('is-open');
                navToggle.setAttribute('aria-expanded', 'false');
                navToggle.setAttribute('aria-label', 'Open navigation');
            });
        });

        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && this.state) {
                this.setChatState(false, chatBox);
            }
        });
    }

    toggleState(chatbox, trigger) {
        this.setChatState(!this.state, chatbox, trigger);
    }

    setChatState(isOpen, chatbox, trigger) {
        this.state = isOpen;
        if (isOpen) {
            this.lastTrigger = trigger;
            chatbox.classList.add('chatbox--active');
        } else {
            chatbox.classList.remove('chatbox--active');
        }

        chatbox.setAttribute('aria-hidden', String(!isOpen));
        this.args.openButtons.forEach(button => {
            button.setAttribute('aria-expanded', String(isOpen));
        });

        if (isOpen) {
            chatbox.querySelector('input').focus();
        } else if (this.lastTrigger) {
            this.lastTrigger.focus();
        }
    }

    escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;')
            .replace(/&lt;br\s*\/?&gt;/gi, '<br>');
    }

    onSendButton(chatbox) {
        var textField = chatbox.querySelector('input');
        let text1 = textField.value.trim()
        if (text1 === "") {
            return;
        }

        let msg1 = { name: "User", message: text1 }
        this.messages.push(msg1);

        fetch('/predict', {
            method: 'POST',
            body: JSON.stringify({ message: text1}),
            mode: 'cors',
            headers: {
               'Content-Type': 'application/json'
            },
          })
          .then(r => r.json())
          .then(r => {
            if (!r.answer) {
                throw new Error(r.error || 'The chatbot returned an invalid response.');
            }
            //let msg2 = { name: "Sam", message1: r.answer[0][0], message11: r.answer[0][1], prob1: r.answer[0][2], message2: r.answer[1][0], message21: r.answer[1][1], prob2: r.answer[1][2], message3: r.answer[2][0], message31: r.answer[2][1], prob3: r.answer[2][2]};
            let msg2 = {name: "Sam", message1: r.answer[0], message2: r.answer[1], message3: r.answer[2], centers: r.answer.slice(1), conditions: r.answer[1]}
            this.messages.push(msg2);
            this.updateChatText(chatbox)
            textField.value = ''

        }).catch((error) => {
            console.error('Error:', error);
            this.messages.push({name: "Sam", message1: "not_understand", message2: "Sorry, I couldn't process that message. Please try again."});
            this.updateChatText(chatbox)
            textField.value = ''
        });
    }

    updateChatText(chatbox) {
        var html = '';
        const specificTags = ["greeting", "goodbye","work","who","Thanks","joke", "name", "age", "gender", "not_understand"]
        this.messages.forEach((item, index) => {
            
            if (item.name === "Sam")
            {
                /*html +=  '<div class="myDIV">' + item.message3 + item.prob3 + '</div>' 
                    + '<div class="hide">' + item.message31 +'</div>'
                    + '<div class="myDIV">' + item.message2 + item.prob2 + '</div>'
                    + '<div class="hide">' + item.message21 + '</div>'
                    + '<div class="myDIV">' + item.message1 + item.prob1 + '</div>'
                    + '<div class="hide">' + item.message11 + '</div>'
                    + '<div class="con" style="margin-top:20px; margin-bottom:10px"><h3>These may be the possible diseases that you may have.</h3></div>'
                */
                if (specificTags.includes(item.message1)){
                    html += '<div class="messages__item messages__item--visitor">' + this.escapeHtml(item.message2) + '</div>'
                }
                else if (item.message1 === "conditions"){
                    html += '<div class="messages__item messages__item--visitor">Possible matches from the chatbot symptom examples; this is not a diagnosis:</div>';
                    (item.conditions || []).forEach(condition => {
                        const matchedSymptoms = Array.isArray(condition[1]) ? condition[1].join(', ') : '';
                        html += '<div class="messages__item messages__item--visitor"><strong>Possible match: '
                            + this.escapeHtml(condition[0])
                            + '</strong><br>Matching symptoms: '
                            + this.escapeHtml(matchedSymptoms)
                            + '</div>';
                    });
                }
                else if (item.message1 === "center"){
                    const centers = (item.centers || [item.message2, item.message3, item.message4]).filter(Array.isArray);
                    html += '<div class="messages__item messages__item--visitor">Nearby medical centers, when location information is available:</div>';
                    if (centers.length) {
                        centers.forEach(center => {
                            html += '<div class="myDIV" style="font-size: 17px;">' + this.escapeHtml(center[0]) + ', ' + this.escapeHtml(center[1]) + '</div>'
                                + '<div class="hide">' + this.escapeHtml(center[2]) + '</div>';
                        });
                    } else {
                        html += '<div class="messages__item messages__item--visitor">I could not determine your location. Please search for a nearby medical center directly.</div>';
                    }
                }
                else{

                    html += '<div class="messages__item messages__item--visitor">Do you want to know about the nearby medical center locations</div>'
                            + '<div class="accordion" id="accordionExample">'
                                + '<div class="accordion-item" style="width: 40%; margin-top: 10px" >'
                                + '<h2 class="accordion-header" id="headingOne">'
                                + '<button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#collapseTwo" aria-expanded="false" aria-controls="collapseTwo">'
                                + '<b>Precautions</b>'
                                + '</button>'
                                + '</h2>'
                                + '<div id="collapseTwo" class="accordion-collapse collapse" aria-labelledby="headingTwo" data-bs-parent="#accordionExample">'
                                + '<div class="accordion-body">'
                                + this.escapeHtml(item.message3)
                                + '</div>'
                                + '</div>'
                                + '</div>'
                                + '</div>'
                            + '<div class="accordion" id="accordionExample">'
                                    + '<div class="accordion-item" style="width: 40%; margin-top: 10px" >'
                                    + '<h2 class="accordion-header" id="headingThree">'
                                    + '<button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#collapseThree" aria-expanded="false" aria-controls="collapseThree">'
                                    + '<b>Description</b>'
                                    + '</button>'
                                    + '</h2>'
                                    + '<div id="collapseThree" class="accordion-collapse collapse" aria-labelledby="headingThree" data-bs-parent="#accordionExample">'
                                    + '<div class="accordion-body">'
                                    + this.escapeHtml(item.message2)
                                    + '</div>'
                                    + '</div>'
                                    + '</div>'
                                    + '</div>'
                            + '<div class="messages__item messages__item--visitor">Here  is some more info on the disease</div>'
                            + '<div class="myDIV">' + this.escapeHtml(item.message1) + '</div>'
                            + '<div class="con" style="margin-top:20px; margin-bottom:10px"><h3>Possible condition information to discuss with a healthcare professional; this is not a diagnosis.</h3></div>'
                }
            }
            else
            {
                html += '<div class="messages__item messages__item--operator">' + this.escapeHtml(item.message) + '</div>'
            }
          });
        const chatmessage = chatbox.querySelector('.chatbox__messages');
        chatmessage.innerHTML = html;
        chatmessage.scrollTop = chatmessage.scrollHeight;
    }
    
}


const chatbox = new Chatbox();
chatbox.display();
